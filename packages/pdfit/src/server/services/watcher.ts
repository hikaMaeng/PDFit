import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
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
}): WatcherController {
  const { booksRoot, rootFolderName, resolveFolderPath, metadataStore } = options;
  const bus = new EventEmitter();
  const dirWatchers = new Map<string, fs.FSWatcher>();

  async function reconcile(): Promise<void> {
    try {
      for (const ref of await metadataStore.listTrackedBooks()) {
        const filePath = path.join(resolveFolderPath(ref.folder), ref.filename);
        if (!fs.existsSync(filePath)) {
          await metadataStore.purgeFile(ref.folder, ref.filename);
        }
      }

      await metadataStore.purgeOrphanTags();
    } catch (error) {
      console.error('[watcher] reconcile failed:', error);
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
    if (dirWatchers.has(dir) || !fs.existsSync(dir)) {
      return;
    }

    try {
      const watcher = fs.watch(dir, (_event, name) => {
        if (!name) {
          return;
        }

        const fullPath = path.join(dir, name);
        const exists = fs.existsSync(fullPath);

        if (dir === booksRoot) {
          if (exists) {
            try {
              if (fs.statSync(fullPath).isDirectory()) {
                watchDir(fullPath);
              }
            } catch {
              return;
            }
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
      });

      watcher.on('error', () => closeWatcher(dir));
      dirWatchers.set(dir, watcher);
    } catch (error) {
      console.warn(`[watcher] failed to watch ${dir}:`, error);
    }
  }

  async function indexBooks(): Promise<void> {
    const books: BookRecord[] = [];
    const folders = [{ name: rootFolderName, dir: booksRoot }];
    if (fs.existsSync(booksRoot)) {
      for (const entry of fs.readdirSync(booksRoot, { withFileTypes: true })) {
        if (entry.isDirectory()) folders.push({ name: entry.name, dir: path.join(booksRoot, entry.name) });
      }
    }
    for (const folder of folders) {
      if (!fs.existsSync(folder.dir)) continue;
      for (const entry of fs.readdirSync(folder.dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.pdf')) continue;
        const stat = fs.statSync(path.join(folder.dir, entry.name));
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
    if (fs.existsSync(booksRoot)) {
      for (const entry of fs.readdirSync(booksRoot, { withFileTypes: true })) {
        if (entry.isDirectory()) watchDir(path.join(booksRoot, entry.name));
      }
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
      watchDir(booksRoot);
    },
  };
}
