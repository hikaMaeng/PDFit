import { randomUUID } from 'node:crypto';
import type { OcrScanJob } from '../../common/protocol/ocr/scan.js';

export interface OcrDocument {
  folder: string;
  filename: string;
  sourcePath: string;
  cacheStamp: string;
  stamp: string;
}

export class OcrScanError extends Error {
  constructor(readonly reason: NonNullable<OcrScanJob['failure']>, message: string) {
    super(message);
  }
}

interface ScanOptions {
  resolveDocument(folder: string, filename: string): Promise<OcrDocument>;
  assertCurrent(document: OcrDocument): Promise<void>;
  prepare(document: OcrDocument): Promise<number>;
  listIndexedPages(document: OcrDocument, pageIndex?: number): Promise<number[]>;
  recognizePage(document: OcrDocument, pageIndex: number): Promise<void>;
  concurrency(): Promise<number>;
  log(message: string): void;
}

interface ScanState {
  key: string;
  folder: string;
  filename: string;
  job: OcrScanJob;
  document: OcrDocument | null;
  preparing: boolean;
  nextPage: number;
}

export type OcrScanService = ReturnType<typeof createOcrScan>;

const RECENT_JOB_LIMIT = 100;
const bookKey = (folder: string, filename: string) => JSON.stringify([folder, filename]);
const snapshot = (job: OcrScanJob) => ({ ...job, activePages: [...job.activePages] });

/** One dispatcher per PDFit runtime, with a single rotating queue of documents. */
export function createOcrScan(options: ScanOptions) {
  const running = new Map<string, ScanState>();
  const ready = new Set<ScanState>();
  const recent = new Map<string, OcrScanJob>();
  let active = 0;
  let pumping = false;

  function finishIfIdle(state: ScanState) {
    const { job } = state;
    if (state.preparing || job.activePages.length || ready.has(state)) return;
    job.status = job.status === 'stopping' ? 'failed' : job.status === 'cancelling' ? 'cancelled' : 'completed';
    running.delete(state.key);
    recent.set(state.key, job);
    if (recent.size > RECENT_JOB_LIMIT) {
      const oldest = recent.keys().next();
      if (!oldest.done) recent.delete(oldest.value);
    }
  }

  function stopOnError(state: ScanState, page: number, error: unknown) {
    const { job } = state;
    if (job.status === 'running') {
      ready.delete(state);
      job.status = 'stopping';
      job.failure = error instanceof OcrScanError ? error.reason : 'error';
      job.failedPage = page;
    }
    options.log(`scan of ${state.folder}/${state.filename}, page ${page}: ${String(error)}`);
  }

  async function runPage(state: ScanState, document: OcrDocument, page: number) {
    const { job } = state;
    try {
      await options.assertCurrent(document);
      const indexed = await options.listIndexedPages(document, page - 1);
      if (job.status !== 'running') return;
      if (!indexed.length) await options.recognizePage(document, page - 1);
      job.processedPages += 1;
    } catch (error) {
      stopOnError(state, page, error);
    } finally {
      job.activePages.splice(job.activePages.indexOf(page), 1);
      active -= 1;
      finishIfIdle(state);
      void pump();
    }
  }

  async function pump() {
    if (pumping || !ready.size) return;
    pumping = true;
    try {
      const concurrency = await options.concurrency().catch(() => 1);
      while (active < concurrency) {
        const next = ready.values().next();
        if (next.done) break;
        const state = next.value;
        const { job } = state;
        ready.delete(state);
        const page = state.nextPage++;
        if (state.nextPage <= job.pageCount!) ready.add(state);
        job.activePages.push(page);
        active += 1;
        void runPage(state, state.document!, page);
      }
    } finally {
      pumping = false;
    }
  }

  async function prepare(state: ScanState) {
    const { job } = state;
    try {
      const document = await options.resolveDocument(state.folder, state.filename);
      if (job.status !== 'running') return;
      job.pageCount = await options.prepare(document);
      if (job.status !== 'running') return;
      if (job.startPage > job.pageCount) throw new Error(`Start page is outside 1..${job.pageCount}.`);
      state.document = document;
      ready.add(state);
    } catch (error) {
      stopOnError(state, job.startPage, error);
    } finally {
      state.preparing = false;
      finishIfIdle(state);
      void pump();
    }
  }

  function get(folder: string, filename: string): OcrScanJob | null {
    const key = bookKey(folder, filename);
    const job = running.get(key)?.job ?? recent.get(key);
    return job ? snapshot(job) : null;
  }

  return {
    get,
    start(folder: string, filename: string, startPage: number): OcrScanJob {
      const key = bookKey(folder, filename);
      const existing = running.get(key);
      if (existing) return snapshot(existing.job);
      const job: OcrScanJob = {
        id: randomUUID(), status: 'running', startPage, pageCount: null, activePages: [], processedPages: 0,
      };
      const state = { key, folder, filename, job, document: null, preparing: true, nextPage: startPage };
      recent.delete(key);
      running.set(key, state);
      void prepare(state);
      return snapshot(job);
    },
    cancel(folder: string, filename: string, id: string): OcrScanJob | null {
      const state = running.get(bookKey(folder, filename));
      if (state?.job.id === id && state.job.status === 'running') {
        state.job.status = 'cancelling';
        ready.delete(state);
        finishIfIdle(state);
      }
      return get(folder, filename);
    },
    async listPages(folder: string, filename: string): Promise<number[]> {
      return options.listIndexedPages(await options.resolveDocument(folder, filename));
    },
  };
}
