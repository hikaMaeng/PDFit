import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { UPLOAD_STAGING_PREFIX } from './filesystem.js';
import { createLibraryVolumeGuard, type LibraryVolumeGuard } from './libraryVolume.js';
import type { BookRecord, MetadataStore } from '../../shared/index.js';

export interface WatcherController {
  bus: EventEmitter;
  start(): void;
  refresh(): Promise<void>;
  commitUpload(persist: () => Promise<BookRecord[]>): Promise<BookRecord[]>;
  mutateFiles<T>(operation: () => Promise<T>): Promise<T>;
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

export function createWatcher(options: {
  booksRoot: string;
  rootFolderName: string;
  resolveFolderPath: (folder: string) => string;
  metadataStore: MetadataStore;
  /** Every disk access goes through it so a dead mount cannot hang the server. */
  volume?: LibraryVolumeGuard;
}): WatcherController {
  const { booksRoot, rootFolderName, metadataStore } = options;
  const volume = options.volume ?? createLibraryVolumeGuard();
  const stat = (target: string) => volume.run(() => fs.promises.stat(target)).catch((error: unknown) => {
    if (isMissing(error)) return null;
    throw error;
  });
  const bus = new EventEmitter();
  const dirWatchers = new Map<string, fs.FSWatcher>();
  let indexWrites = Promise.resolve();
  let activeScan: AbortController | undefined;
  let refreshing: Promise<void> | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;

  function queueIndexWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = indexWrites.then(operation);
    indexWrites = result.then(() => undefined, () => undefined);
    return result;
  }

  function mutateFiles<T>(operation: () => Promise<T>): Promise<T> {
    activeScan?.abort();
    return queueIndexWrite(operation);
  }

  function scheduleRefresh(): void {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      void refresh().catch((error) => console.warn('[watcher] background library refresh failed:', error));
    }, 500);
    refreshTimer.unref();
  }

  async function commitUpload(persist: () => Promise<BookRecord[]>): Promise<BookRecord[]> {
    // The Free upload response and change events follow the index commit. See apps/pdfit/docs/api.md#server-routes.
    try {
      const books = await mutateFiles(async () => {
        const uploaded = await persist();
        await metadataStore.syncBooks(uploaded);
        return uploaded;
      });
      bus.emit('change', 'folders-changed');
      bus.emit('change', 'tags-changed');
      return books;
    } finally {
      // A scan can also recover already-persisted files after an indexing error.
      if (!refreshing) scheduleRefresh();
    }
  }

  function closeWatcher(dir: string): void {
    const watcher = dirWatchers.get(dir);
    if (watcher) {
      try {
        watcher.close();
      } catch {
        // ignore close races
      }
      dirWatchers.delete(dir);
    }
  }

  function watchDir(dir: string): void {
    if (dirWatchers.has(dir)) {
      return;
    }

    try {
      const watcher = fs.watch(dir, { persistent: false }, (event, name) => {
        if (event !== 'rename' || !name || (name.startsWith(UPLOAD_STAGING_PREFIX) && name.endsWith('.part'))) {
          return;
        }
        void handleChange(dir, name).catch((error) => console.warn('[watcher] file change failed:', error));
      });

      watcher.on('error', () => closeWatcher(dir));
      dirWatchers.set(dir, watcher);
    } catch (error) {
      console.warn(`[watcher] failed to watch ${dir}:`, error);
    }
  }

  async function handleChange(dir: string, name: string): Promise<void> {
    const isRoot = dir === booksRoot;
    const isPdf = name.toLowerCase().endsWith('.pdf');
    if (!isRoot && !isPdf) return;
    const fullPath = path.join(dir, name);
    // A volume that cannot answer is not evidence that the file is gone: change events
    // from a flapping mount must never purge database rows.
    if (volume.isOffline()) return;
    const entry = await stat(fullPath);
    if (volume.isOffline()) return;

    if (entry) {
      if (isRoot && entry.isDirectory()) {
        watchDir(fullPath);
        bus.emit('change', 'folders-changed');
      }
      return;
    }

    const removed = await mutateFiles(async () => {
      // A file can be replaced by a completed upload while this event waits.
      if (volume.isOffline() || await stat(fullPath) || volume.isOffline()) return false;
      if (isPdf) {
        await metadataStore.purgeFile(isRoot ? rootFolderName : path.basename(dir), name);
      } else {
        closeWatcher(fullPath);
        await metadataStore.purgeFolder(name);
      }
      await metadataStore.purgeOrphanTags();
      return true;
    });
    if (!removed) return;
    bus.emit('change', 'folders-changed');
    bus.emit('change', 'tags-changed');
    bus.emit('change', 'favorites-changed');
  }

  async function scanBooks(signal: AbortSignal): Promise<BookRecord[]> {
    const books: BookRecord[] = [];
    const readDir = async (dir: string) => {
      signal.throwIfAborted();
      const entries = await volume.run(() => fs.promises.readdir(dir, { withFileTypes: true }));
      signal.throwIfAborted();
      watchDir(dir);
      return entries;
    };
    // Every read here is asynchronous: a dead network mount must fail this call,
    // not freeze the event loop for everyone else. An unreachable root rejects
    // before anything is written, so an offline volume never looks like an empty library.
    const rootEntries = await readDir(booksRoot);
    const collect = async (folder: string, dir: string, entries: fs.Dirent[]) => {
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.pdf')) continue;
        signal.throwIfAborted();
        const info = await stat(path.join(dir, entry.name));
        if (info?.isFile()) books.push({ folder, filename: entry.name, size: info.size, modified_at: info.mtime.toISOString() });
      }
    };
    await collect(rootFolderName, booksRoot, rootEntries);
    for (const entry of rootEntries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(booksRoot, entry.name);
      let entries: fs.Dirent[];
      try { entries = await readDir(dir); }
      catch (error) { if (isMissing(error)) continue; throw error; }
      await collect(entry.name, dir, entries);
    }
    signal.throwIfAborted();
    return books;
  }

  async function refreshIndex(): Promise<void> {
    for (;;) {
      const pendingWrites = indexWrites;
      await pendingWrites;
      if (pendingWrites !== indexWrites) continue;
      const controller = new AbortController();
      activeScan = controller;
      const { signal } = controller;
      try {
        const books = await scanBooks(signal);
        await queueIndexWrite(async () => {
          signal.throwIfAborted();
          await metadataStore.syncBooks(books);
        });
        signal.throwIfAborted();
        bus.emit('change', 'folders-changed');
        bus.emit('change', 'tags-changed');
        return;
      } catch (error) {
        if (!signal.aborted) throw error;
      } finally {
        activeScan = undefined;
      }
    }
  }

  function refresh(): Promise<void> {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = undefined;
    refreshing ??= refreshIndex().finally(() => { refreshing = undefined; });
    return refreshing;
  }

  return {
    bus,
    refresh,
    commitUpload,
    mutateFiles,
    start() {
      // Startup must never scan or synchronize the library. Watch only the
      // root so newly-created folders can be discovered; existing folder
      // watchers are attached during the explicit refresh operation.
      // The existence probe is asynchronous so an unreachable volume cannot stall boot.
      void stat(booksRoot).then((entry) => { if (entry?.isDirectory()) watchDir(booksRoot); }).catch(() => {});
    },
  };
}
