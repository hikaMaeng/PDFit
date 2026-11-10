import type { Router } from 'express';
import type { EventEmitter } from 'node:events';
import type { MetadataStore } from '../../shared/index.js';
import { createEventsRouter } from '../api/events/index.js';
import { createFoldersRouter } from '../api/folders/index.js';
import { createProgressRouter } from '../api/progress/index.js';
import { createTagsRouter } from '../api/tags/index.js';
import { createViewerStateRouter } from '../api/viewer-state/index.js';
import { createBookmarksRouter } from '../api/bookmarks/index.js';
import { createAnnotationsRouter } from '../api/annotations/index.js';
import { createFilesystemService } from '../services/filesystem.js';
import { createWatcher } from '../services/watcher.js';
import express from 'express';
import path from 'node:path';
import type { MetadataStoreResolver } from '../routes/metadataStoreResolver.js';
import type { BookTagSuggestionProvider } from '../services/tagSuggestion.js';
import type { AutomaticTagUsage } from '../routes/tags.js';
import { createTasksRouter } from '../api/tasks/index.js';
import { createPdfitTaskScheduler, type PdfitTaskSchedulerOptions } from '../tasks/backgroundTasks.js';
import type { TaskScheduler } from '../tasks/taskScheduler.js';
import { createThumbnailStore } from '../thumbnails/thumbnailStore.js';
import { createThumbnailService, THUMBNAIL_TASK_TYPE } from '../thumbnails/thumbnailTask.js';

export interface PdfitServerRouterMount {
  path: string;
  router: Router;
}

export interface PdfitCommonRouterAssembly {
  routers: PdfitServerRouterMount[];
  filesystem: ReturnType<typeof createFilesystemService>;
  watcher: ReturnType<typeof createWatcher>;
  /** Present when `backgroundTasks` was configured. */
  tasks?: TaskScheduler;
}

/**
 * Periodic background work for the local runtime. Omit to run without it. The scheduler
 * settings are the shared ones; a hosted runtime builds its scheduler with the same
 * `createPdfitTaskScheduler` and registers its own jobs.
 */
export interface PdfitBackgroundTaskOptions extends PdfitTaskSchedulerOptions {
  /** Directory for generated first-page thumbnails. */
  thumbnailRoot: string;
  /** Set false to build the scheduler without starting its timers. */
  autoStart?: boolean;
}

/** Builds the canonical PDFit metadata, bookmark, viewer-state, and event routes. */
export function createPdfitMetadataRouterMounts(
  metadataStore: MetadataStoreResolver,
  eventBus: EventEmitter,
  suggestBookTags?: BookTagSuggestionProvider,
  automaticTagUsage?: AutomaticTagUsage,
): PdfitServerRouterMount[] {
  return [
    { path: '/api/progress', router: createProgressRouter(metadataStore) },
    { path: '/api/tags', router: createTagsRouter(metadataStore, suggestBookTags, automaticTagUsage) },
    { path: '/api/events', router: createEventsRouter(eventBus) },
    { path: '/api/viewer-state', router: createViewerStateRouter(metadataStore) },
    { path: '/api/bookmarks', router: createBookmarksRouter(metadataStore) },
    { path: '/api/annotations', router: createAnnotationsRouter(metadataStore) },
  ];
}

export function createPdfitCommonRouterAssembly(options: {
  metadataStore: MetadataStore;
  booksRoot: string;
  bookmarkAssetRoot?: string;
  booksRootName?: string;
  watcherEnabled?: boolean;
  maxUploadBytes?: number;
  suggestBookTags?: BookTagSuggestionProvider;
  backgroundTasks?: PdfitBackgroundTaskOptions;
}): PdfitCommonRouterAssembly {
  const filesystem = createFilesystemService(options.booksRoot, options.booksRootName);
  filesystem.ensureBooksRoot();
  const bookmarkAssetRoot = path.resolve(options.bookmarkAssetRoot ?? path.resolve(options.booksRoot, '..', 'bookmarks'));
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

  // One scheduler and one worker pool serve every periodic job. A job is added by
  // registering its definition here; thumbnails are the first.
  let tasks: TaskScheduler | undefined;
  let thumbnails: ReturnType<typeof createThumbnailService> | undefined;
  if (options.backgroundTasks) {
    const background = options.backgroundTasks;
    const scheduler = createPdfitTaskScheduler(background);
    thumbnails = createThumbnailService({
      booksRoot: options.booksRoot,
      rootFolderName: filesystem.rootFolderName,
      store: createThumbnailStore(background.thumbnailRoot),
      submit: (task) => scheduler.submit(THUMBNAIL_TASK_TYPE, task),
      log: (message) => console.log(`[tasks] ${message}`),
    });
    scheduler.register(thumbnails.definition);
    if (background.autoStart ?? true) scheduler.start();
    tasks = scheduler;
  }
  const thumbnailService = thumbnails;

  return {
    filesystem,
    watcher,
    tasks,
    routers: [
      { path: '/api/folders', router: createFoldersRouter(
        filesystem, watcher.refresh, (folder) => options.metadataStore.listBooksByFolder(folder),
        () => options.metadataStore.listFolderBookCounts(),
        () => options.metadataStore.listFolderColors(),
        (folder, color) => options.metadataStore.updateFolderColor(folder, color),
        { purgeFile: (folder, filename) => options.metadataStore.purgeFile(folder, filename), purgeFolder: (folder) => options.metadataStore.purgeFolder(folder) },
        options.maxUploadBytes,
        (event) => watcher.bus.emit('change', event),
        thumbnailService,
      ) },
      ...(tasks ? [{ path: '/api/tasks', router: createTasksRouter(tasks, () => ({ thumbnail: { lastPlan: thumbnailService?.lastPlan() ?? null } })) }] : []),
      ...createPdfitMetadataRouterMounts(options.metadataStore, watcher.bus, options.suggestBookTags),
      { path: '/api/bookmark-assets', router: express.Router().use(express.static(bookmarkAssetRoot)).use(express.static(legacyBookmarkAssetRoot)) },
    ],
  };
}
