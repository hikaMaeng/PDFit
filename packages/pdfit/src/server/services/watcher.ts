import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { createLibraryVolumeGuard, type LibraryVolumeGuard } from './libraryVolume.js';
import type { BookRecord, MetadataStore } from '../../shared/index.js';

export interface WatcherController {
  bus: EventEmitter;
  start(): void;
  refresh(): Promise<void>;
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
      const watcher = fs.watch(dir, (_event, name) => {
        if (!name) {
          return;
        }
        void handleChange(dir, String(name));
      });

      watcher.on('error', () => closeWatcher(dir));
      dirWatchers.set(dir, watcher);
    } catch (error) {
      console.warn(`[watcher] failed to watch ${dir}:`, error);
    }
  }

  async function handleChange(dir: string, name: string): Promise<void> {
    const fullPath = path.join(dir, name);
    // A volume that cannot answer is not evidence that the file is gone: change events
    // from a flapping mount must never purge database rows.
    if (volume.isOffline()) return;
    const exists = await present(fullPath);
    if (volume.isOffline()) return;

    if (dir === booksRoot) {
      if (exists) {
        const isDirectory = await volume.run(() => fs.promises.stat(fullPath)).then((stat) => stat.isDirectory(), () => false);
        if (isDirectory) watchDir(fullPath);
      } else {
        closeWatcher(fullPath);
        if (name.toLowerCase().endsWith('.pdf')) {
          void metadataStore.purgeFile(rootFolderName, name);
        } else {
          void metadataStore.purgeFolder(name);
        }
        void metadataStore.purgeOrphanTags();
      }

      bus.emit('change', 'folders-changed');
      bus.emit('change', 'tags-changed');
      return;
    }

    if (!name.toLowerCase().endsWith('.pdf')) {
      return;
    }

    if (!exists) {
      void metadataStore.purgeFile(path.basename(dir), name);
      void metadataStore.purgeOrphanTags();
      bus.emit('change', 'tags-changed');
    }

    bus.emit('change', 'folders-changed');
  }

  async function indexBooks(): Promise<void> {
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
        const stat = await volume.run(() => fs.promises.stat(path.join(folder.dir, entry.name)));
        books.push({ folder: folder.name, filename: entry.name, size: stat.size, modified_at: stat.mtime.toISOString() });
      }
    }
    await metadataStore.syncBooks(books);
  }

  async function refresh(): Promise<void> {
    // A user-triggered refresh must be non-destructive. Files on network or
    // sync-backed folders can disappear temporarily; only watcher-driven
    // deletion handling may reconcile metadata.
    await indexBooks();
    watchDir(booksRoot);
    for (const entry of await volume.run(() => fs.promises.readdir(booksRoot, { withFileTypes: true }))) {
      if (entry.isDirectory()) watchDir(path.join(booksRoot, entry.name));
    }
    bus.emit('change', 'folders-changed');
    bus.emit('change', 'tags-changed');
  }

  return {
    bus,
    refresh,
    start() {
      // Startup must never scan or synchronize the library. Watch only the
      // root so newly-created folders can be discovered; existing folder
      // watchers are attached during the explicit refresh operation.
      // The existence probe is asynchronous so an unreachable volume cannot stall boot.
      void present(booksRoot).then((exists) => { if (exists) watchDir(booksRoot); });
    },
  };
}
