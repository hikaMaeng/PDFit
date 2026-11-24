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
  purgeFile(folder: string, filename: string): Promise<void>;
  purgeFolder(folder: string): Promise<void>;
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
  const present = (target: string) => volume.run(() => fs.promises.access(target)).then(() => true, () => false);
  const bus = new EventEmitter();
  const dirWatchers = new Map<string, fs.FSWatcher>();
  let indexWrites = Promise.resolve();
  let indexRevision = 0;
  let refreshing: Promise<void> | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;

  function queueIndexWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = indexWrites.then(operation);
    indexWrites = result.then(() => undefined, () => undefined);
    return result;
  }

  function changeIndex<T>(operation: () => Promise<T>): Promise<T> {
    return queueIndexWrite(async () => {
      try { return await operation(); }
      finally { indexRevision += 1; }
    });
  }

  const purgeFile = (folder: string, filename: string) => changeIndex(() => metadataStore.purgeFile(folder, filename));
  const purgeFolder = (folder: string) => changeIndex(() => metadataStore.purgeFolder(folder));

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
      const books = await changeIndex(async () => {
        const uploaded = await persist();
        await metadataStore.syncBooks(uploaded);
        return uploaded;
      });
      bus.emit('change', 'folders-changed');
      bus.emit('change', 'tags-changed');
      return books;
    } finally {
      // A scan can also recover already-persisted files after an indexing error.
      scheduleRefresh();
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
    const exists = await present(fullPath);
    if (volume.isOffline()) return;

    if (exists) {
      if (isRoot && !isPdf) {
        const isDirectory = await volume.run(() => fs.promises.stat(fullPath)).then((stat) => stat.isDirectory(), () => false);
        if (isDirectory) {
          watchDir(fullPath);
          bus.emit('change', 'folders-changed');
        }
      }
      return;
    }

    const removed = await changeIndex(async () => {
      // A file can be replaced by a completed upload while this event waits.
      if (volume.isOffline() || await present(fullPath) || volume.isOffline()) return false;
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

  async function scanBooks(): Promise<{ books: BookRecord[]; dirs: string[] }> {
    const books: BookRecord[] = [];
    const folders = [{ name: rootFolderName, dir: booksRoot }];
    // Every read here is asynchronous: a dead network mount must fail this call,
    // not freeze the event loop for everyone else. An unreachable root rejects
    // before anything is written, so an offline volume never looks like an empty library.
    for (const entry of await volume.run(() => fs.promises.readdir(booksRoot, { withFileTypes: true }))) {
      if (entry.isDirectory()) folders.push({ name: entry.name, dir: path.join(booksRoot, entry.name) });
    }
    for (const folder of folders) {
      let entries: fs.Dirent[];
      try { entries = await volume.run(() => fs.promises.readdir(folder.dir, { withFileTypes: true })); }
      catch (error) {
        if (folder.dir === booksRoot) throw error;
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.pdf')) continue;
        try {
          const stat = await volume.run(() => fs.promises.stat(path.join(folder.dir, entry.name)));
          books.push({ folder: folder.name, filename: entry.name, size: stat.size, modified_at: stat.mtime.toISOString() });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    }
    return { books, dirs: folders.map((folder) => folder.dir) };
  }

  async function refreshIndex(): Promise<void> {
    for (;;) {
      const revision = indexRevision;
      const snapshot = await scanBooks();
      const applied = await queueIndexWrite(async () => {
        // An upload or deletion during the scan supersedes its snapshot.
        if (revision !== indexRevision) return false;
        await metadataStore.syncBooks(snapshot.books);
        return true;
      });
      if (!applied) continue;
      for (const dir of snapshot.dirs) watchDir(dir);
      bus.emit('change', 'folders-changed');
      bus.emit('change', 'tags-changed');
      return;
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
    purgeFile,
    purgeFolder,
    start() {
      // Startup must never scan or synchronize the library. Watch only the
      // root so newly-created folders can be discovered; existing folder
      // watchers are attached during the explicit refresh operation.
      // The existence probe is asynchronous so an unreachable volume cannot stall boot.
      void present(booksRoot).then((exists) => { if (exists) watchDir(booksRoot); });
    },
  };
}
