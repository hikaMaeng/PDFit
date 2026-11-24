import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_TASK_PRIORITY, INTERACTIVE_TASK_PRIORITY, type TaskEnvelope, type TaskOutcome } from '../tasks/taskProtocol.js';
import type { PeriodicTaskDefinition, PlannedTask, TaskSubmitOutcome } from '../tasks/taskScheduler.js';
import type { BookmarkOcr, BookmarkRecord } from '../../common/protocol/bookmarks/index.js';
import type { PageTextRect, PageTextTaskPayload, PageTextWorkerResult } from './pdfPageTextTask.worker.js';
import { meaningfulLength } from './pdfPageTextTask.worker.js';
import { createVisionOcrQueue, visionOcrConcurrency, type VisionImageType, type VisionOcrServer } from './visionOcr.js';
import { thumbnailIdentityHash } from '../thumbnails/thumbnailStore.js';
import { restorePageOcrSearchIndex, type PageOcrSearchIndex } from './pageOcrSearchIndex.js';
import { createOcrScan, OcrScanError, type OcrDocument, type OcrScanService } from './ocrScan.js';

export const PAGE_TEXT_TASK_TYPE = 'page-text';
export const PAGE_TEXT_TASK_SCRIPT_URL = new URL(import.meta.url.endsWith('.ts') ? './pdfPageTextTask.worker.ts' : './pdfPageTextTask.worker.js', import.meta.url);
/** Above the periodic backlog, like an interactive thumbnail request. */
const INTERACTIVE_PRIORITY = INTERACTIVE_TASK_PRIORITY;
const PAGE_RENDER = { width: 1600, quality: 85 } as const;
/** A clip is re-rendered from the PDF for the vision model (at most 4x, so ~1600 px for a column-wide clip) instead of sending its screen capture. */
const CLIP_RENDER = { width: 1600, quality: 90 } as const;
/** Bumped when the text-layer rules change, so cached page results made under older rules are not served. */
const PAGE_CACHE_VERSION = 'v2';
/** A waiting caller gives up after this long (queue wait plus the text task). */
const PAGE_TEXT_WAIT_MS = 10 * 60 * 1000;
const PENDING_BOOKMARKS_PER_PLAN = 200;

export type OcrSource = 'text-layer' | 'vision';

export interface PageOcrResult {
  text: string;
  /** `none` when the page has no text layer and no vision model is configured. */
  source: OcrSource | 'none';
  cached: boolean;
  pageIndex: number;
  pageCount: number;
  durationMs: number;
}

/** Bookmark persistence the OCR service needs. Optional MetadataStore methods. */
export interface BookmarkOcrStore {
  listBookmarksWithOcrStatus(status: BookmarkOcr['status'], limit: number): Promise<BookmarkRecord[]>;
  getBookmark(id: string): Promise<BookmarkRecord | null>;
  setBookmarkOcr(id: string, ocr: Omit<BookmarkOcr, 'updatedAt'>): Promise<boolean>;
}

export interface OcrServiceOptions {
  /** Absolute path of a local library file, or null when it does not exist. */
  resolveSourcePath(folder: string, filename: string): Promise<string | null>;
  /** File identity for the legacy cache name and for the library metadata row. */
  sourceStamps(sourcePath: string): Promise<{ cacheStamp: string; stamp: string }>;
  submit(task: PlannedTask<PageTextOcrPayload>): TaskSubmitOutcome;
  resolveVisionServer?: () => Promise<VisionOcrServer | null>;
  /** Directory for cached page results. */
  cacheRoot: string;
  pageSearchIndex?: PageOcrSearchIndex;
  bookmarks?: BookmarkOcrStore & {
    /** Absolute path of the saved clip image. */
    imagePath(bookmark: BookmarkRecord): string;
  };
  request?: typeof fetch;
  log?: (message: string) => void;
}

/** The queued payload: what the worker needs plus what the main thread needs afterwards. */
export interface PageTextOcrPayload extends PageTextTaskPayload {
  folder: string;
  filename: string;
  /** Set for a clip bookmark; the result is written to that bookmark. */
  bookmarkId?: string;
}

interface Waiter { resolve(result: PageTextWorkerResult): void; reject(error: Error): void }

export interface OcrService {
  definition: PeriodicTaskDefinition<PageTextOcrPayload, PageTextWorkerResult>;
  scan?: OcrScanService;
  /** Marks the bookmark pending and queues it. Returns false for a non-local file. */
  enqueueBookmark(bookmark: BookmarkRecord): Promise<boolean>;
  /** Text of one page: cache, then text layer, then the vision model on a rendering. */
  recognizePage(folder: string, filename: string, pageIndex: number): Promise<PageOcrResult>;
}

export function pageOcrCacheName(folder: string, filename: string, stamp: string, pageIndex: number): string {
  const hash = thumbnailIdentityHash(folder, filename);
  return `${hash}.${stamp}.p${pageIndex}.json`;
}

export function createOcrService(options: OcrServiceOptions): OcrService {
  const log = options.log ?? (() => undefined);
  const request = options.request ?? fetch;
  const pageSearchIndex = options.pageSearchIndex;
  let restoringPageIndex: Promise<void> | undefined;

  async function indexPage(folder: string, filename: string, stamp: string, result: Pick<PageOcrResult, 'source' | 'pageIndex' | 'text'>) {
    if (pageSearchIndex && result.source !== 'none' && result.text.trim()) {
      await pageSearchIndex.save(folder, filename, stamp, result.pageIndex, result.text)
        .catch(() => log('Could not index page OCR text.'));
    }
  }

  /**
   * Callers waiting for a page-text task.
   *   key       task key (`page:<hash>:<stamp>:<index>`), unique per page and file state
   *   scope     this process
   *   lifetime  until the task settles or PAGE_TEXT_WAIT_MS passes
   *   bound     the task queue's capacity: a key is added only after the queue accepted it
   *   cleared   by onSettled (settled), the wait timer (timeout), or a rejected submit
   * Their payloads are re-planned so a periodic plan cannot drop a waited-for task.
   */
  const waiting = new Map<string, { task: PlannedTask<PageTextOcrPayload>; waiters: Waiter[]; timer: NodeJS.Timeout }>();

  const runVision = createVisionOcrQueue(request);
  const resolveVision = () => options.resolveVisionServer?.().catch(() => null) ?? Promise.resolve(null);
  const vision = async (image: { bytes: Buffer; type: VisionImageType }, priority: number): Promise<string | null> => {
    const server = await resolveVision();
    if (!server) return null;
    return runVision(server, image, priority);
  };

  async function finishBookmark(payload: PageTextOcrPayload, outcome: TaskOutcome<PageTextWorkerResult>) {
    const store = options.bookmarks;
    const id = payload.bookmarkId;
    if (!store || !id) return;
    try {
      if (!outcome.ok) throw new Error(outcome.error.message);
      const result = outcome.result;
      if (!('text' in result)) throw new Error('Missing clip OCR result.');
      const layerText = meaningfulLength(result.text) > 0 ? result.text : null;
      if (layerText !== null && !result.untrusted) {
        await store.setBookmarkOcr(id, { status: 'done', text: layerText, source: 'text-layer', error: null });
        return;
      }
      // No text, or a garbled hidden OCR layer: read the area with the vision model, from a
      // fresh high-resolution rendering, else from the saved screen capture.
      let image: { bytes: Buffer; type: VisionImageType };
      if (result.image) image = { bytes: Buffer.from(result.image.jpegBase64, 'base64'), type: 'image/jpeg' };
      else {
        const bookmark = await store.getBookmark(id);
        if (!bookmark) return;
        image = { bytes: await fs.readFile(store.imagePath(bookmark)), type: 'image/jpeg' };
      }
      const text = await vision(image, DEFAULT_TASK_PRIORITY);
      if (text === null) {
        // Without a vision server a garbled layer still beats nothing.
        if (layerText !== null) await store.setBookmarkOcr(id, { status: 'done', text: layerText, source: 'text-layer', error: null });
        else await store.setBookmarkOcr(id, { status: 'unavailable', text: null, source: null, error: 'No AI server with a vision or LLM model is configured.' });
        return;
      }
      await store.setBookmarkOcr(id, { status: 'done', text, source: 'vision', error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`bookmark ${id} OCR failed: ${message}`);
      await store.setBookmarkOcr(id, { status: 'failed', text: null, source: null, error: message.slice(0, 500) }).catch(() => false);
    }
  }

  const definition: PeriodicTaskDefinition<PageTextOcrPayload, PageTextWorkerResult> = {
    type: PAGE_TEXT_TASK_TYPE,
    script: PAGE_TEXT_TASK_SCRIPT_URL,
    timeoutMs: 2 * 60 * 1000,
    async plan() {
      if (pageSearchIndex && !restoringPageIndex) {
        restoringPageIndex = restorePageOcrSearchIndex(options.cacheRoot, PAGE_CACHE_VERSION, pageSearchIndex).catch(() => {
          log('Could not restore the page OCR search index. The next plan will retry.');
          restoringPageIndex = undefined;
        });
      }
      const planned = [...waiting.values()].map((entry) => entry.task);
      // Bookmarks left pending by a restart. Failed and unavailable ones wait for a retry.
      const pending = options.bookmarks ? await options.bookmarks.listBookmarksWithOcrStatus('pending', PENDING_BOOKMARKS_PER_PLAN).catch(() => []) : [];
      for (const bookmark of pending) {
        const payload = await bookmarkPayload(bookmark);
        if (payload) planned.push({ key: `bookmark:${bookmark.id}`, payload });
      }
      return planned;
    },
    onSettled(task: TaskEnvelope<PageTextOcrPayload>, outcome) {
      const entry = waiting.get(task.key);
      if (entry) {
        waiting.delete(task.key);
        clearTimeout(entry.timer);
        for (const waiter of entry.waiters) {
          if (outcome.ok) waiter.resolve(outcome.result);
          else waiter.reject(new Error(outcome.error.message));
        }
      }
      // The vision step can take minutes: never hold the worker slot for it.
      if (task.payload.bookmarkId) void finishBookmark(task.payload, outcome);
    },
  };

  async function bookmarkPayload(bookmark: BookmarkRecord): Promise<PageTextOcrPayload | null> {
    const sourcePath = await options.resolveSourcePath(bookmark.folder, bookmark.filename);
    if (!sourcePath) return null;
    const rect: PageTextRect = { ...bookmark.rect };
    return { sourcePath, pageIndex: bookmark.pageIndex, rect, render: CLIP_RENDER, folder: bookmark.folder, filename: bookmark.filename, bookmarkId: bookmark.id };
  }

  function runPageText(key: string, payload: PageTextOcrPayload, priority: number): Promise<PageTextWorkerResult> {
    return new Promise((resolve, reject) => {
      const existing = waiting.get(key);
      if (existing) {
        existing.waiters.push({ resolve, reject });
        if (priority > (existing.task.priority ?? DEFAULT_TASK_PRIORITY)) {
          existing.task.priority = priority;
          options.submit(existing.task);
        }
        return;
      }
      const task = { key, payload, priority };
      const outcome = options.submit(task);
      if (outcome === 'full' || outcome === 'unknown-type') {
        reject(new Error(outcome === 'full' ? 'The background task queue is full; try again shortly.' : 'Background tasks are not running.'));
        return;
      }
      const timer = setTimeout(() => {
        const entry = waiting.get(key);
        if (!entry) return;
        waiting.delete(key);
        for (const waiter of entry.waiters) waiter.reject(new Error('Timed out waiting for the page text task.'));
      }, PAGE_TEXT_WAIT_MS);
      timer.unref?.();
      waiting.set(key, { task, waiters: [{ resolve, reject }], timer });
    });
  }

  async function resolveDocument(folder: string, filename: string): Promise<OcrDocument> {
    const sourcePath = await options.resolveSourcePath(folder, filename);
    if (!sourcePath) throw Object.assign(new Error('File not found.'), { status: 404 });
    return { folder, filename, sourcePath, ...await options.sourceStamps(sourcePath) };
  }

  async function assertCurrent(document: OcrDocument): Promise<void> {
    const current = await options.sourceStamps(document.sourcePath).catch(() => null);
    if (current?.stamp !== document.stamp || current.cacheStamp !== document.cacheStamp) {
      throw new OcrScanError('source-changed', 'The PDF changed during the scan.');
    }
  }

  async function clearOldPageCaches(document: OcrDocument) {
    const prefix = `${thumbnailIdentityHash(document.folder, document.filename)}.`;
    const stamp = `${prefix}${PAGE_CACHE_VERSION}-${document.cacheStamp}.`;
    for (const name of await fs.readdir(options.cacheRoot).catch(() => [] as string[])) {
      if (name.startsWith(prefix) && !name.startsWith(stamp)) await fs.rm(path.join(options.cacheRoot, name), { force: true });
    }
  }

  async function readPage(document: OcrDocument, pageIndex: number, background: boolean): Promise<PageOcrResult> {
    const started = Date.now();
    const { folder, filename, sourcePath, stamp, cacheStamp } = document;
    const cacheName = pageOcrCacheName(folder, filename, `${PAGE_CACHE_VERSION}-${cacheStamp}`, pageIndex);
    const cachePath = path.join(options.cacheRoot, cacheName);
    try {
      const { text, source, pageCount, metadataStamp } = JSON.parse(await fs.readFile(cachePath, 'utf8')) as
        Omit<PageOcrResult, 'cached' | 'durationMs'> & { metadataStamp?: string };
      if (typeof text === 'string' && (metadataStamp === undefined || metadataStamp === stamp) && (!background || text.trim())) {
        return { text, source, pageCount, pageIndex, cached: true, durationMs: Date.now() - started };
      }
    } catch { /* not cached */ }

    const key = `page:${cacheName.replace(/\.json$/, '')}`;
    const priority = background ? DEFAULT_TASK_PRIORITY : INTERACTIVE_PRIORITY;
    const result = await runPageText(key, { sourcePath, pageIndex, render: PAGE_RENDER, folder, filename }, priority);
    if (!('text' in result)) throw new Error('Missing page OCR result.');
    let text = result.text;
    let source: PageOcrResult['source'] = 'text-layer';
    const hasLayerText = meaningfulLength(text) > 0;
    if (!hasLayerText || result.untrusted) {
      const recognized = result.image ? await vision({ bytes: Buffer.from(result.image.jpegBase64, 'base64'), type: 'image/jpeg' }, priority) : null;
      if (recognized !== null) { text = recognized; source = 'vision'; }
      // Without a vision server a garbled layer is still returned as the layer's text.
      else if (!hasLayerText) { text = ''; source = 'none'; }
    }
    const record = { text, source, pageIndex, pageCount: result.pageCount };
    return { ...record, cached: false, durationMs: Date.now() - started };
  }

  async function cachePage(document: OcrDocument, result: PageOcrResult, cleanup: boolean) {
    const { text, source, pageIndex, pageCount, cached } = result;
    // Configuring a vision model takes effect on the next request when OCR was unavailable.
    if (cached || source === 'none') return;
    const { folder, filename, stamp, cacheStamp } = document;
    const cacheName = pageOcrCacheName(folder, filename, `${PAGE_CACHE_VERSION}-${cacheStamp}`, pageIndex);
    const cachePath = path.join(options.cacheRoot, cacheName);
    await fs.mkdir(options.cacheRoot, { recursive: true });
    if (cleanup) await clearOldPageCaches(document);
    const temporary = `${cachePath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify({ text, source, pageIndex, pageCount, metadataStamp: stamp }), 'utf8');
      await fs.rename(temporary, cachePath);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }

  const queryIndexedPages = pageSearchIndex?.listPages?.bind(pageSearchIndex);
  // Every scan in this runtime hands its completed result to one serial listener.
  let scanResults: Promise<void> = Promise.resolve();
  const scan = pageSearchIndex && queryIndexedPages ? createOcrScan({
    resolveDocument,
    assertCurrent,
    async prepare(document) {
      const { folder, filename, sourcePath, cacheStamp } = document;
      const key = `count:${thumbnailIdentityHash(folder, filename)}:${cacheStamp}`;
      const result = await runPageText(key, { sourcePath, pageIndex: null, folder, filename }, DEFAULT_TASK_PRIORITY);
      await assertCurrent(document);
      await clearOldPageCaches(document);
      return result.pageCount;
    },
    listIndexedPages: ({ folder, filename, stamp }, pageIndex) => queryIndexedPages(folder, filename, stamp, pageIndex),
    async recognizePage(document, pageIndex) {
      const result = await readPage(document, pageIndex, true);
      if (result.source === 'none') throw new OcrScanError('unavailable', 'No vision model could read the page.');
      const received = scanResults.then(async () => {
        await assertCurrent(document);
        await cachePage(document, result, false);
        if (!result.text.trim()) return;
        const { folder, filename, stamp } = document;
        await pageSearchIndex.save(folder, filename, stamp, pageIndex, result.text);
        if (!(await queryIndexedPages(folder, filename, stamp, pageIndex)).length) throw new Error('Page OCR text was not saved.');
      });
      scanResults = received.catch(() => undefined);
      await received;
    },
    concurrency: async () => visionOcrConcurrency(await resolveVision()),
    log,
  }) : undefined;

  return {
    definition,
    scan,
    async enqueueBookmark(bookmark) {
      if (!options.bookmarks) return false;
      const payload = await bookmarkPayload(bookmark);
      if (!payload) return false;
      await options.bookmarks.setBookmarkOcr(bookmark.id, { status: 'pending', text: null, source: null, error: null });
      const outcome = options.submit({ key: `bookmark:${bookmark.id}`, payload });
      // 'full' leaves it pending: the next periodic plan picks it up.
      return outcome !== 'unknown-type';
    },
    async recognizePage(folder, filename, pageIndex) {
      const started = Date.now();
      const document = await resolveDocument(folder, filename);
      const result = await readPage(document, pageIndex, false);
      await cachePage(document, result, true);
      await indexPage(folder, filename, document.stamp, result);
      return { ...result, durationMs: Date.now() - started };
    },
  };
}
