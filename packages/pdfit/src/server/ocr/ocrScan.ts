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
  recognizePage(document: OcrDocument, pageIndex: number, trace: OcrScanTrace, queueSignal: AbortSignal): Promise<void>;
  concurrency(): Promise<number>;
  log(message: string): void;
}

interface ScanState {
  key: string;
  folder: string;
  filename: string;
  job: OcrScanJob & { modelPages: NonNullable<OcrScanJob['modelPages']> };
  document: OcrDocument | null;
  preparing: boolean;
  nextPage: number;
  startedAt: number;
  queuedPages: AbortController;
}

export type OcrScanService = ReturnType<typeof createOcrScan>;
export type OcrScanTrace = (phase: string, details?: Record<string, unknown>) => void;

const RECENT_JOB_LIMIT = 100;
const bookKey = (folder: string, filename: string) => JSON.stringify([folder, filename]);
const snapshot = (job: OcrScanJob) => ({ ...job, activePages: [...job.activePages], modelPages: { ...job.modelPages } });

function errorFields(error: unknown) {
  if (!(error instanceof Error)) return { errorName: 'NonError' };
  const safeCode = (code: unknown) => typeof code === 'string' && /^[\w-]{1,80}$/.test(code) ? code : undefined;
  return {
    errorName: safeCode(error.name) ?? 'Error',
    errorCode: safeCode((error as NodeJS.ErrnoException).code),
    causeCode: safeCode((error.cause as NodeJS.ErrnoException | undefined)?.code),
  };
}

/** One dispatcher per PDFit runtime, with a single rotating queue of documents. */
export function createOcrScan(options: ScanOptions) {
  const running = new Map<string, ScanState>();
  const ready = new Set<ScanState>();
  const recent = new Map<string, OcrScanJob>();
  let active = 0;
  let pumping = false;

  // Runtime log contract in docs/api.md#document-scan.
  function log(event: string, state: ScanState, details?: Record<string, unknown>) {
    const { job } = state;
    options.log(`scan ${JSON.stringify({
      event, jobId: job.id, status: job.status, elapsedMs: Math.round(performance.now() - state.startedAt),
      ...details,
    })}`);
  }

  function finishIfIdle(state: ScanState) {
    const { job } = state;
    if (state.preparing || job.activePages.length || ready.has(state)) return;
    job.status = job.status === 'stopping' ? 'failed' : job.status === 'cancelling' ? 'cancelled' : 'completed';
    log('job.finished', state, { pageCount: job.pageCount, processedPages: job.processedPages, failure: job.failure, failedPage: job.failedPage });
    running.delete(state.key);
    recent.set(state.key, job);
    if (recent.size > RECENT_JOB_LIMIT) {
      const oldest = recent.keys().next();
      if (!oldest.done) recent.delete(oldest.value);
    }
  }

  function stopOnError(state: ScanState, page: number, phase: string, phaseMs: number, error: unknown) {
    const { job } = state;
    const stopsDispatch = job.status === 'running';
    const reason = error instanceof OcrScanError ? error.reason : 'error';
    if (stopsDispatch) {
      ready.delete(state);
      job.status = 'stopping';
      job.failure = reason;
      job.failedPage = page;
      state.queuedPages.abort();
    }
    log('work.failed', state, { page, phase, phaseMs, reason, stopsDispatch, activePages: job.activePages, ...errorFields(error) });
  }

  async function runPage(state: ScanState, document: OcrDocument, page: number) {
    const { job } = state;
    const started = performance.now();
    let phase = 'source-check';
    let phaseStarted = started;
    let outcome = 'skipped-after-stop';
    const trace: OcrScanTrace = (next, details) => {
      if (next === 'vision-queued') job.modelPages[page] = 'queued';
      else if (next === 'vision-request') job.modelPages[page] = 'running';
      else if (next === 'persist-queued') delete job.modelPages[page];
      const now = performance.now();
      log('page.phase', state, { page, phase: next, previousPhase: phase, previousPhaseMs: Math.round(now - phaseStarted), ...details });
      phase = next;
      phaseStarted = now;
    };
    try {
      await options.assertCurrent(document);
      trace('index-lookup');
      const indexed = await options.listIndexedPages(document, page - 1);
      if (job.status !== 'running') return;
      if (!indexed.length) await options.recognizePage(document, page - 1, trace, state.queuedPages.signal);
      job.processedPages += 1;
      outcome = indexed.length ? 'already-indexed' : 'processed';
    } catch (error) {
      if (error === state.queuedPages.signal.reason && state.queuedPages.signal.aborted) return;
      outcome = 'failed';
      stopOnError(state, page, phase, Math.round(performance.now() - phaseStarted), error);
    } finally {
      delete job.modelPages[page];
      job.activePages.splice(job.activePages.indexOf(page), 1);
      active -= 1;
      log('page.finished', state, { page, outcome, phase, phaseMs: Math.round(performance.now() - phaseStarted), pageMs: Math.round(performance.now() - started), active });
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
        // Give a newly ready book a slot as soon as an admitted page finishes.
        // The Set preserves round-robin order when books have the same number in flight.
        let state: ScanState | undefined;
        for (const candidate of ready) {
          if (!state || candidate.job.activePages.length < state.job.activePages.length) state = candidate;
        }
        if (!state) break;
        const { job } = state;
        ready.delete(state);
        const page = state.nextPage++;
        if (state.nextPage <= job.pageCount!) ready.add(state);
        job.activePages.push(page);
        active += 1;
        log('page.dispatched', state, { page, phase: 'source-check', active, concurrency });
        void runPage(state, state.document!, page);
      }
    } finally {
      pumping = false;
    }
  }

  async function prepare(state: ScanState) {
    const { job } = state;
    let phase = 'resolve-document';
    let phaseStarted = performance.now();
    try {
      const document = await options.resolveDocument(state.folder, state.filename);
      if (job.status !== 'running') return;
      phase = 'prepare-document';
      phaseStarted = performance.now();
      log('job.preparing', state, { phase });
      job.pageCount = await options.prepare(document);
      if (job.status !== 'running') return;
      if (job.startPage > job.pageCount) throw new Error(`Start page is outside 1..${job.pageCount}.`);
      state.document = document;
      log('job.ready', state, { pageCount: job.pageCount });
      ready.add(state);
    } catch (error) {
      stopOnError(state, job.startPage, phase, Math.round(performance.now() - phaseStarted), error);
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
      const job: ScanState['job'] = {
        id: randomUUID(), status: 'running', startPage, pageCount: null, activePages: [], modelPages: {}, processedPages: 0,
      };
      const state = { key, folder, filename, job, document: null, preparing: true, nextPage: startPage, startedAt: performance.now(), queuedPages: new AbortController() };
      recent.delete(key);
      running.set(key, state);
      log('job.started', state, { folder, filename, startPage, phase: 'resolve-document' });
      void prepare(state);
      return snapshot(job);
    },
    cancel(folder: string, filename: string, id: string): OcrScanJob | null {
      const state = running.get(bookKey(folder, filename));
      if (state?.job.id === id && state.job.status === 'running') {
        state.job.status = 'cancelling';
        ready.delete(state);
        state.queuedPages.abort();
        log('job.cancelling', state, { activePages: state.job.activePages });
        finishIfIdle(state);
      }
      return get(folder, filename);
    },
    async listPages(folder: string, filename: string): Promise<number[]> {
      return options.listIndexedPages(await options.resolveDocument(folder, filename));
    },
  };
}
