import type { Router } from 'express';
import type { EventEmitter } from 'node:events';
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
import type { MetadataStoreResolver } from '../routes/metadataStoreResolver.js';

export interface PdfitServerRouterMount {
  path: string;
  router: Router;
}

export interface PdfitCommonRouterAssembly {
  routers: PdfitServerRouterMount[];
  filesystem: ReturnType<typeof createFilesystemService>;
  watcher: ReturnType<typeof createWatcher>;
}

/** Builds the canonical PDFit metadata, bookmark, viewer-state, and event routes. */
export function createPdfitMetadataRouterMounts(
  metadataStore: MetadataStoreResolver,
  eventBus: EventEmitter,
): PdfitServerRouterMount[] {
  return [
    { path: '/api/progress', router: createProgressRouter(metadataStore) },
    { path: '/api/tags', router: createTagsRouter(metadataStore) },
    { path: '/api/events', router: createEventsRouter(eventBus) },
    { path: '/api/viewer-state', router: createViewerStateRouter(metadataStore) },
    { path: '/api/bookmarks', router: createBookmarksRouter(metadataStore) },
  ];
}

export function createPdfitCommonRouterAssembly(options: {
  metadataStore: MetadataStore;
  booksRoot: string;
  booksRootName?: string;
  watcherEnabled?: boolean;
  maxUploadBytes?: number;
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
        { purgeFile: (folder, filename) => options.metadataStore.purgeFile(folder, filename), purgeFolder: (folder) => options.metadataStore.purgeFolder(folder) },
        options.maxUploadBytes,
        (event) => watcher.bus.emit('change', event),
      ) },
      ...createPdfitMetadataRouterMounts(options.metadataStore, watcher.bus),
      { path: '/api/bookmark-assets', router: express.Router().use(express.static(bookmarkAssetRoot)).use(express.static(legacyBookmarkAssetRoot)) },
    ],
  };
}
