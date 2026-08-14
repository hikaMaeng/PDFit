import type { Router } from 'express';
import type { MetadataStore } from '../../shared/index.js';
import { createEventsRouter } from '../api/events/index.js';
import { createFoldersRouter } from '../api/folders/index.js';
import { createProgressRouter } from '../api/progress/index.js';
import { createTagsRouter } from '../api/tags/index.js';
import { createViewerStateRouter } from '../api/viewer-state/index.js';
import { createBookmarksRouter } from '../api/bookmarks/index.js';
import { createFilesystemService } from '../services/filesystem.js';
import { createWatcher } from '../services/watcher.js';
import express from 'express';
import path from 'node:path';

export interface PdfitServerRouterMount {
  path: string;
  router: Router;
}

export interface PdfitCommonRouterAssembly {
  routers: PdfitServerRouterMount[];
  filesystem: ReturnType<typeof createFilesystemService>;
  watcher: ReturnType<typeof createWatcher>;
}

export function createPdfitCommonRouterAssembly(options: {
  metadataStore: MetadataStore;
  booksRoot: string;
  booksRootName?: string;
  watcherEnabled?: boolean;
}): PdfitCommonRouterAssembly {
  const filesystem = createFilesystemService(options.booksRoot, options.booksRootName);
  filesystem.ensureBooksRoot();
  const bookmarkAssetRoot = path.resolve(options.booksRoot, '..', 'bookmarks');
  const legacyBookmarkAssetRoot = path.resolve(options.booksRoot, '..', '..', 'bookmarks');

  const watcher = createWatcher({
    booksRoot: options.booksRoot,
    rootFolderName: filesystem.rootFolderName,
    resolveFolderPath: filesystem.getFolderPath,
    metadataStore: options.metadataStore,
  });

  if (options.watcherEnabled ?? true) {
    watcher.start();
  }

  return {
    filesystem,
    watcher,
    routers: [
      { path: '/api/folders', router: createFoldersRouter(
        filesystem, watcher.refresh, (folder) => options.metadataStore.listBooksByFolder(folder),
        () => options.metadataStore.listFolderBookCounts(),
        () => options.metadataStore.listFolderColors(),
        (folder, color) => options.metadataStore.updateFolderColor(folder, color),
      ) },
      { path: '/api/progress', router: createProgressRouter(options.metadataStore) },
      { path: '/api/tags', router: createTagsRouter(options.metadataStore) },
      { path: '/api/events', router: createEventsRouter(watcher.bus) },
      { path: '/api/viewer-state', router: createViewerStateRouter(options.metadataStore) },
      { path: '/api/bookmarks', router: createBookmarksRouter(options.metadataStore) },
      { path: '/api/bookmark-assets', router: express.Router().use(express.static(bookmarkAssetRoot)).use(express.static(legacyBookmarkAssetRoot)) },
    ],
  };
}
