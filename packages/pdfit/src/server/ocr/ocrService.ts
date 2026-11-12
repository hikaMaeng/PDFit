import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { INTERACTIVE_TASK_PRIORITY, type TaskEnvelope, type TaskOutcome } from '../tasks/taskProtocol.js';
import type { PeriodicTaskDefinition, PlannedTask, TaskSubmitOutcome } from '../tasks/taskScheduler.js';
import type { BookmarkOcr, BookmarkRecord } from '../../common/protocol/bookmarks/index.js';
import type { PageTextRect, PageTextTaskPayload, PageTextTaskResult } from './pdfPageTextTask.worker.js';
import { meaningfulLength } from './pdfPageTextTask.worker.js';
import { recognizeImageText, type VisionImageType, type VisionOcrServer } from './visionOcr.js';

export const PAGE_TEXT_TASK_TYPE = 'page-text';
export const PAGE_TEXT_TASK_SCRIPT_URL = new URL(import.meta.url.endsWith('.ts') ? './pdfPageTextTask.worker.ts' : './pdfPageTextTask.worker.js', import.meta.url);
/** Above the periodic backlog, like an interactive thumbnail request. */
const INTERACTIVE_PRIORITY = INTERACTIVE_TASK_PRIORITY;
const PAGE_RENDER = { width: 1600, quality: 85 } as const;
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
  /** The source's modification stamp, `<mtimeMs>-<size>`, for the page cache key. */
  sourceStamp(sourcePath: string): Promise<string>;
  submit(task: PlannedTask<PageTextOcrPayload>): TaskSubmitOutcome;
  resolveVisionServer?: () => Promise<VisionOcrServer | null>;
  /** Directory for cached page results. */
  cacheRoot: string;
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

interface Waiter { resolve(result: PageTextTaskResult): void; reject(error: Error): void }

export interface OcrService {
  definition: PeriodicTaskDefinition<PageTextOcrPayload, PageTextTaskResult>;
  /** Marks the bookmark pending and queues it. Returns false for a non-local file. */
  enqueueBookmark(bookmark: BookmarkRecord): Promise<boolean>;
  /** Text of one page: cache, then text layer, then the vision model on a rendering. */
  recognizePage(folder: string, filename: string, pageIndex: number): Promise<PageOcrResult>;
}

export function pageOcrCacheName(folder: string, filename: string, stamp: string, pageIndex: number): string {
  const hash = createHash('sha1').update(`${folder}\u0000${filename}`).digest('hex');
  return `${hash}.${stamp}.p${pageIndex}.json`;
}

export function createOcrService(options: OcrServiceOptions): OcrService {
  const log = options.log ?? (() => undefined);
  const request = options.request ?? fetch;

  /**
   * Callers waiting for a page-text task.
   *   key       task key (`page:<hash>:<stamp>:<index>`), unique per page and file state
   *   scope     this process
   *   lifetime  until the task settles or PAGE_TEXT_WAIT_MS passes
   *   bound     the task queue's capacity: a key is added only after the queue accepted it
   *   cleared   by onSettled (settled), the wait timer (timeout), or a rejected submit
   * Their payloads are re-planned so a periodic plan cannot drop a waited-for task.
   */
  const waiting = new Map<string, { payload: PageTextOcrPayload; waiters: Waiter[]; timer: NodeJS.Timeout }>();

  // One vision request at a time: a local model serves one image at a time anyway.
  let visionQueue: Promise<unknown> = Promise.resolve();
  const serialVision = <T>(action: () => Promise<T>): Promise<T> => {
    const next = visionQueue.then(action, action);
    visionQueue = next.then(() => undefined, () => undefined);
    return next;
  };
  const vision = async (image: { bytes: Buffer; type: VisionImageType }): Promise<string | null> => {
    const server = options.resolveVisionServer ? await options.resolveVisionServer().catch(() => null) : null;
    if (!server) return null;
    return serialVision(() => recognizeImageText(server, image, request));
  };

  async function finishBookmark(payload: PageTextOcrPayload, outcome: TaskOutcome<PageTextTaskResult>) {
    const store = options.bookmarks;
    const id = payload.bookmarkId;
    if (!store || !id) return;
    try {
      if (!outcome.ok) throw new Error(outcome.error.message);
      if (meaningfulLength(outcome.result.text) > 0) {
        await store.setBookmarkOcr(id, { status: 'done', text: outcome.result.text, source: 'text-layer', error: null });
        return;
      }
      const bookmark = await store.getBookmark(id);
      if (!bookmark) return;
      const bytes = await fs.readFile(store.imagePath(bookmark));
      const text = await vision({ bytes, type: 'image/jpeg' });
      if (text === null) {
        await store.setBookmarkOcr(id, { status: 'unavailable', text: null, source: null, error: 'No AI server with a vision or LLM model is configured.' });
        return;
      }
      await store.setBookmarkOcr(id, { status: 'done', text, source: 'vision', error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`bookmark ${id} OCR failed: ${message}`);
      await store.setBookmarkOcr(id, { status: 'failed', text: null, source: null, error: message.slice(0, 500) }).catch(() => false);
    }
  }

  const definition: PeriodicTaskDefinition<PageTextOcrPayload, PageTextTaskResult> = {
    type: PAGE_TEXT_TASK_TYPE,
    script: PAGE_TEXT_TASK_SCRIPT_URL,
    timeoutMs: 2 * 60 * 1000,
    async plan() {
      const planned: PlannedTask<PageTextOcrPayload>[] = [...waiting.entries()].map(([key, entry]) => ({ key, payload: entry.payload, priority: INTERACTIVE_PRIORITY }));
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
    return { sourcePath, pageIndex: bookmark.pageIndex, rect, folder: bookmark.folder, filename: bookmark.filename, bookmarkId: bookmark.id };
  }

  function runPageText(key: string, payload: PageTextOcrPayload): Promise<PageTextTaskResult> {
    return new Promise((resolve, reject) => {
      const existing = waiting.get(key);
      if (existing) { existing.waiters.push({ resolve, reject }); return; }
      const outcome = options.submit({ key, payload, priority: INTERACTIVE_PRIORITY });
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
      waiting.set(key, { payload, waiters: [{ resolve, reject }], timer });
    });
  }

  return {
    definition,
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
      const sourcePath = await options.resolveSourcePath(folder, filename);
      if (!sourcePath) throw Object.assign(new Error('File not found.'), { status: 404 });
      const stamp = await options.sourceStamp(sourcePath);
      const cacheName = pageOcrCacheName(folder, filename, stamp, pageIndex);
      const cachePath = path.join(options.cacheRoot, cacheName);
      try {
        const cached = JSON.parse(await fs.readFile(cachePath, 'utf8')) as Omit<PageOcrResult, 'cached' | 'durationMs'>;
        if (typeof cached.text === 'string') return { ...cached, cached: true, durationMs: Date.now() - started };
      } catch { /* not cached */ }

      const key = `page:${cacheName.replace(/\.json$/, '')}`;
      const result = await runPageText(key, { sourcePath, pageIndex, render: PAGE_RENDER, folder, filename });
      let text = result.text;
      let source: PageOcrResult['source'] = 'text-layer';
      if (meaningfulLength(text) === 0) {
        const recognized = result.image ? await vision({ bytes: Buffer.from(result.image.jpegBase64, 'base64'), type: 'image/jpeg' }) : null;
        text = recognized ?? '';
        source = recognized === null ? 'none' : 'vision';
      }
      const record = { text, source, pageIndex, pageCount: result.pageCount };
      // `none` is not cached, so configuring a vision model takes effect on the next request.
      if (source !== 'none') {
        await fs.mkdir(options.cacheRoot, { recursive: true });
        // Results for an older state of this file are no longer reachable: delete them.
        const prefix = cacheName.slice(0, 41);
        for (const name of await fs.readdir(options.cacheRoot).catch(() => [] as string[])) {
          if (name.startsWith(prefix) && !name.startsWith(`${prefix}${stamp}.`)) await fs.rm(path.join(options.cacheRoot, name), { force: true });
        }
        const temporary = `${cachePath}.tmp`;
        await fs.writeFile(temporary, JSON.stringify(record), 'utf8');
        await fs.rename(temporary, cachePath);
      }
      return { ...record, cached: false, durationMs: Date.now() - started };
    },
  };
}
