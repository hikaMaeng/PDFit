import type { Router } from 'express';
import type { EventEmitter } from 'node:events';
import type { MetadataStore } from '../../shared/index.js';
import { createEventsRouter } from '../api/events/index.js';
import { createFoldersRouter } from '../api/folders/index.js';
import { createProgressRouter } from '../api/progress/index.js';
import { createTagsRouter } from '../api/tags/index.js';
import { createSearchRouter } from '../api/search/index.js';
import { createFavoritesRouter } from '../api/favorites/index.js';
import { createTagFoldersRouter } from '../api/tag-folders/index.js';
import { TAG_FOLDERS_PATH } from '../../common/protocol/tagFolders/index.js';
import { createViewerStateRouter } from '../api/viewer-state/index.js';
import { createOutlinesRouter } from '../routes/outlines.js';
import { createBookmarksRouter } from '../api/bookmarks/index.js';
import { createAnnotationsRouter } from '../api/annotations/index.js';
import { createBookCommentsRouter } from '../routes/bookComments.js';
import { BOOK_COMMENTS_PATH } from '../../common/protocol/book-comments/index.js';
import { createFilesystemService } from '../services/filesystem.js';
import { createWatcher } from '../services/watcher.js';
import { createLibraryFileOperations, type LibraryFileOperations } from '../services/libraryFileOperations.js';
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
import { createCoverOverrideStore, type CoverOverrideStore } from '../covers/coverOverrideStore.js';
import { createCoversRouter } from '../routes/covers.js';
import fs from 'node:fs';
import { createOcrService, PAGE_TEXT_TASK_TYPE, type OcrService } from '../ocr/ocrService.js';
import { createOcrRouter } from '../routes/ocr.js';
import type { VisionOcrServer } from '../ocr/visionOcr.js';
import { thumbnailSourceStamp } from '../thumbnails/thumbnailStore.js';
import type { BookmarkOcrQueue } from '../api/bookmarks/index.js';
import { BOOK_BOT_PATH } from '../../common/protocol/book-bot/index.js';
import { createBookBotRouter, type BookBotOptions } from '../book-bot/router.js';

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
  /** Cached page OCR results. Default: `ocr` beside `thumbnailRoot`. */
  ocrCacheRoot?: string;
  /**
   * Vision model for clips and pages without a PDF text layer, resolved on every use.
   * Without it, such areas are marked `unavailable`; text-layer OCR still runs.
   */
  resolveVisionServer?: () => Promise<VisionOcrServer | null>;
  requestVision?: typeof fetch;
}

/** Builds the canonical PDFit metadata, bookmark, viewer-state, and event routes. */
export function createPdfitMetadataRouterMounts(
  metadataStore: MetadataStoreResolver,
  eventBus: EventEmitter,
  suggestBookTags?: BookTagSuggestionProvider,
  automaticTagUsage?: AutomaticTagUsage,
  bookmarkOcr?: BookmarkOcrQueue,
): PdfitServerRouterMount[] {
  return [
    { path: '/api/progress', router: createProgressRouter(metadataStore) },
    { path: '/api/tags', router: createTagsRouter(metadataStore, suggestBookTags, automaticTagUsage) },
    { path: '/api/favorites', router: createFavoritesRouter(metadataStore, eventBus) },
    { path: TAG_FOLDERS_PATH, router: createTagFoldersRouter(metadataStore, eventBus) },
    { path: '/api/search', router: createSearchRouter(metadataStore) },
    { path: '/api/events', router: createEventsRouter(eventBus) },
    { path: '/api/viewer-state', router: createViewerStateRouter(metadataStore) },
    { path: '/api/outlines', router: createOutlinesRouter(metadataStore) },
    { path: '/api/bookmarks', router: createBookmarksRouter(metadataStore, bookmarkOcr) },
    { path: '/api/annotations', router: createAnnotationsRouter(metadataStore) },
    { path: BOOK_COMMENTS_PATH, router: createBookCommentsRouter(metadataStore) },
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
  bookBot?: BookBotOptions;
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
    watchDirectories: options.watcherEnabled,
    volume: filesystem.volume,
  });

  if (options.watcherEnabled ?? true) {
    watcher.start();
  }

  // One scheduler and one worker pool serve every periodic job. A job is added by
  // registering its definition here; thumbnails are the first.
  let tasks: TaskScheduler | undefined;
  let thumbnails: ReturnType<typeof createThumbnailService> | undefined;
  // Real-book covers live beside the rendered thumbnails and exist wherever they do.
  let covers: CoverOverrideStore | undefined;
  let ocr: OcrService | undefined;
  let fileOperations: LibraryFileOperations | undefined;
  if (options.backgroundTasks) {
    const background = options.backgroundTasks;
    const scheduler = createPdfitTaskScheduler(background);
    thumbnails = createThumbnailService({
      booksRoot: options.booksRoot,
      rootFolderName: filesystem.rootFolderName,
      volume: filesystem.volume,
      store: createThumbnailStore(background.thumbnailRoot),
      submit: (task) => scheduler.submit(THUMBNAIL_TASK_TYPE, task),
      log: (message) => console.log(`[tasks] ${message}`),
    });
    scheduler.register(thumbnails.definition);
    covers = createCoverOverrideStore(path.join(background.thumbnailRoot, 'covers'));
    const store = options.metadataStore;
    if (store.libraryFileOperations) {
      fileOperations = createLibraryFileOperations(store.libraryFileOperations, filesystem, watcher, scheduler, covers);
    }
    const resolveSourcePath = async (folder: string, filename: string) => {
      try {
        const sourcePath = fileOperations
          ? await fileOperations.readablePath({ folder, filename: path.basename(filename) })
          : path.resolve(filesystem.getFolderPath(folder), path.basename(filename));
        return (await filesystem.volume.run(() => fs.promises.stat(sourcePath))).isFile() ? sourcePath : null;
      } catch {
        return null;
      }
    };
    ocr = createOcrService({
      resolveSourcePath,
      sourceStamps: async (sourcePath) => {
        const stat = await filesystem.volume.run(() => fs.promises.stat(sourcePath));
        // Keep existing OCR cache names and match the Date used by the library index.
        return { cacheStamp: thumbnailSourceStamp(stat.mtimeMs, stat.size), stamp: thumbnailSourceStamp(stat.mtime.getTime(), stat.size) };
      },
      submit: (task) => scheduler.submit(PAGE_TEXT_TASK_TYPE, task),
      resolveVisionServer: background.resolveVisionServer,
      request: background.requestVision,
      cacheRoot: background.ocrCacheRoot ?? path.join(path.dirname(background.thumbnailRoot), 'ocr'),
      pageSearchIndex: store.savePageOcrText ? {
        listBooks: () => store.listTrackedBooks(),
        save: store.savePageOcrText.bind(store),
        listPages: store.listPageOcrIndexes?.bind(store),
      } : undefined,
      bookmarks: store.getBookmark && store.listBookmarksWithOcrStatus && store.setBookmarkOcr ? {
        getBookmark: (id) => store.getBookmark!(id),
        listBookmarksWithOcrStatus: (status, limit) => store.listBookmarksWithOcrStatus!(status, limit),
        setBookmarkOcr: async (id, value) => {
          const saved = await store.setBookmarkOcr!(id, value);
          if (saved && value.status !== 'pending') watcher.bus.emit('change', 'bookmarks-changed');
          return saved;
        },
        // imageUrl is `/api/bookmark-assets/<image_path>`; the file sits under the asset root.
        imagePath: (bookmark) => path.join(bookmarkAssetRoot, decodeURIComponent(bookmark.imageUrl.replace(/^\/api\/bookmark-assets\//, ''))),
      } : undefined,
      log: (message) => console.log(`[ocr] ${message}`),
    });
    scheduler.register(ocr.definition);
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
        {
          commitUpload: watcher.commitUpload,
          mutateFiles: watcher.mutateFiles,
          purgeFile: (folder, filename) => options.metadataStore.purgeFile(folder, filename),
          purgeFolder: (folder) => options.metadataStore.purgeFolder(folder),
          relocateBook: options.metadataStore.relocateBook?.bind(options.metadataStore),
        },
        options.maxUploadBytes,
        (event) => watcher.bus.emit('change', event),
        thumbnailService,
        covers,
        fileOperations,
        options.metadataStore.listRecentBooks?.bind(options.metadataStore),
      ) },
      ...(covers ? [{ path: '/api/covers', router: createCoversRouter({
        filesystem,
        store: covers,
        stagingDir: options.backgroundTasks ? path.join(options.backgroundTasks.thumbnailRoot, 'covers-staging') : undefined,
        notifyChange: (event) => watcher.bus.emit('change', event),
        hasFile: async (folder, filename) => (await options.metadataStore.listBooksByFolder(folder)).some((book) => book.filename === filename),
      }) }] : []),
      ...(ocr ? [{ path: '/api/ocr', router: createOcrRouter(ocr) }] : []),
      ...(options.bookBot ? [{ path: BOOK_BOT_PATH, router: createBookBotRouter({
        ...options.bookBot,
        getCachedPageText: async ({ folder, filename }, page) =>
          (await ocr?.getCachedPage(folder, filename, page - 1).catch(() => null))?.text ?? null,
      }) }] : []),
      ...(tasks ? [{ path: '/api/tasks', router: createTasksRouter(tasks, async () => ({
        thumbnail: { lastPlan: thumbnailService?.lastPlan() ?? null },
        ...(fileOperations && { libraryFileOperations: await fileOperations.status() }),
      })) }] : []),
      ...createPdfitMetadataRouterMounts(options.metadataStore, watcher.bus, options.suggestBookTags, undefined, ocr),
      { path: '/api/bookmark-assets', router: express.Router().use(express.static(bookmarkAssetRoot)).use(express.static(legacyBookmarkAssetRoot)) },
    ],
  };
}
