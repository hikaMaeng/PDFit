import { Router } from 'express';
import type { AiModelProgress } from '../../common/protocol/ai-model/index.js';
import { isSemanticScope, type ModelChoice, type SemanticScope, type SemanticSearchResult } from '../../common/protocol/embedding-search/index.js';
import type { TaskScheduler } from '../tasks/taskScheduler.js';
import type { ChunkBatch, PlannedChunk } from './chunks.worker.js';
import { EmbeddingClient, EmbeddingUpstreamError, embeddingBatchWidth, type EmbeddingEndpoint } from './client.js';
import { EmbeddingStore, type ActiveIndex, type ReservedWork } from './store.js';

const TASK = 'embedding-index';
const SLICES_PER_PERIOD = 256;
type Run = 'period' | 'drain' | 'activation';
class SearchInputTooLong extends Error {}

export class EmbeddingService {
  private scheduler?: TaskScheduler;
  private remaining = 0;
  private nextRun: Run | null = null;
  private admissionOpen = false;
  private skippedPeriods = 0;
  private working = false;
  private pendingWorker?: ChunkBatch;
  private lastError: string | null = null;
  private reservation?: { active: ActiveIndex; endpoint: EmbeddingEndpoint; work: ReservedWork };

  constructor(readonly store: EmbeddingStore, private readonly getEndpoint: (choice: ModelChoice) => Promise<EmbeddingEndpoint | null>,
    readonly client = new EmbeddingClient()) {}

  register(scheduler: TaskScheduler): void {
    this.scheduler = scheduler;
    scheduler.register<ChunkBatch, PlannedChunk[]>({
      type: TASK, script: new URL('./chunks.worker.js', import.meta.url), preservePending: true, timeoutMs: 10_000,
      plan: async () => { this.startPeriod(); return []; },
      onSettled: (_task, outcome) => {
        // Returning synchronously frees the shared worker before any remote I/O.
        void this.finish(outcome.ok ? outcome.result : null);
      },
      onCapacity: () => this.submitPending(),
    });
  }

  wake(): void {
    this.admissionOpen = false;
    this.nextRun = 'activation';
    void this.slice();
  }

  private startPeriod(): void {
    if (this.working) {
      this.skippedPeriods += 1;
      this.admissionOpen = false;
      this.nextRun ??= 'drain';
    } else {
      this.nextRun ??= 'period';
    }
    void this.slice();
  }

  private submitPending(): void {
    if (!this.pendingWorker || !this.scheduler) return;
    const submitted = this.scheduler.submit(TASK, { key: 'chunks', payload: this.pendingWorker, priority: -1 });
    if (submitted === 'queued') this.pendingWorker = undefined;
  }

  private async slice(): Promise<void> {
    if (!this.scheduler || this.working) return;
    const next = this.nextRun;
    if (next) {
      this.nextRun = null;
      this.admissionOpen = false;
      this.remaining = SLICES_PER_PERIOD;
    }
    if (this.remaining <= 0) return;
    this.working = true;
    this.remaining -= 1;
    let more = false;
    try {
      const active = await this.store.active();
      if (active && (next === 'period' || next === 'activation')) {
        // Waiting leases and deferred retries count. They still occupy existing queue slots.
        const pending = await this.store.hasPending(active);
        if (pending && next === 'period') this.skippedPeriods += 1;
        this.admissionOpen = !pending && this.nextRun === null;
      }
      const cleanup = await this.store.cleanup();
      if (active && !active.blocked && (!active.retryAt || active.retryAt.getTime() <= Date.now())) {
        const endpoint = await this.getEndpoint(active.choice);
        if (!endpoint) throw new Error('Selected embedding model is unavailable');
        const refilled = await this.store.refill(active, this.admissionOpen);
        const width = embeddingBatchWidth(endpoint.model);
        const work = await this.store.reserve(active, width);
        if (work.jobs.length) {
          this.reservation = { active, endpoint, work };
          this.pendingWorker = { width, inputs: work.jobs.map(({ text, position }) => ({ text, offset: position,
            prefixBytes: Buffer.byteLength(endpoint.model.documentPrefix), maxInputTokens: endpoint.model.maxInputTokens })) };
          this.submitPending();
          return;
        }
        more = refilled;
      }
      more ||= cleanup;
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      this.lastError = typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)
        ? `Embedding index processing failed (${code})` : 'Embedding index processing failed';
    } finally {
      if (!this.reservation) this.working = false;
    }
    if (more || this.nextRun) setImmediate(() => void this.slice());
  }

  private async finish(plan: PlannedChunk[] | null): Promise<void> {
    const reservation = this.reservation;
    if (!reservation) return;
    const { active, endpoint, work } = reservation;
    try {
      if (!plan) throw new Error('Could not split embedding input');
      const current = await this.store.renewCurrent(active, work);
      const eligible = plan.filter(({ job }) => current.has(work.jobs[job].source));
      if (!eligible.length) return;
      const texts = eligible.filter(({ chunk }) => chunk.contents.trim()).map(({ chunk }) => endpoint.model.documentPrefix + chunk.contents);
      // Recursive retry splits share one deadline shorter than the reservation.
      const vectors = texts.length ? await this.embedBatch(endpoint, texts, AbortSignal.timeout(100_000)) : [];
      let index = 0;
      const invalid = new Set<string>();
      const items = eligible.map(({ chunk, job }) => {
        const vector = chunk.contents.trim() ? vectors[index++] : null;
        if (chunk.contents.trim() && !vector) invalid.add(work.jobs[job].source);
        return { job: work.jobs[job], chunk, vector };
      });
      if (invalid.size) await this.store.retry(active, work, 'Embedding provider rejected this input', undefined, true, [...invalid]);
      await this.store.publish(active, work, items.filter(({ job }) => !invalid.has(job.source)), endpoint.model.indexDimensions);
      this.lastError = null;
    } catch (error) {
      const upstream = error instanceof EmbeddingUpstreamError ? error : null;
      const permanent = upstream?.status === 401 || upstream?.status === 403 || upstream?.status === 404;
      this.lastError = upstream?.message ?? 'Embedding batch failed';
      try {
        await this.store.retry(active, work, this.lastError, upstream?.retryAt, permanent);
        if (permanent) await this.store.block(active, this.lastError);
        else if (upstream?.status === 429) await this.store.pause(active, upstream.retryAt);
      }
      catch { /* The durable reservation can be acquired after its expiry. */ }
      if (permanent || upstream?.status === 429) this.remaining = 0;
    } finally {
      try { await this.store.release(active, work); }
      catch { /* An unreleased reservation expires in the database. */ }
      this.reservation = undefined;
      this.working = false;
      setImmediate(() => void this.slice());
    }
  }

  private async embedBatch(endpoint: EmbeddingEndpoint, texts: string[], signal: AbortSignal): Promise<(number[] | null)[]> {
    try { return await this.client.embed(endpoint, texts, true, signal); }
    catch (error) {
      if (!(error instanceof EmbeddingUpstreamError) || ![400, 413, 422].includes(error.status)) throw error;
      if (texts.length === 1) return [null];
      const middle = Math.floor(texts.length / 2);
      const first = await this.embedBatch(endpoint, texts.slice(0, middle), signal);
      return first.concat(await this.embedBatch(endpoint, texts.slice(middle), signal));
    }
  }

  async status() {
    const status = await this.store.status(await this.store.active());
    return { ...status, lastError: this.lastError, working: this.working, rescanRequested: this.nextRun !== null,
      skippedPeriods: this.skippedPeriods };
  }

  searchBook(book: { folder: string; filename: string }, q: string, onProgress?: (phase: AiModelProgress) => void) {
    return this.search(q, { book, limit: 12, onProgress });
  }

  private async search(q: string, options: { limit: number; scope?: SemanticScope; book?: { folder: string; filename: string };
    signal?: AbortSignal; onProgress?: (phase: AiModelProgress) => void }): Promise<SemanticSearchResult> {
    const { book, limit, scope, signal, onProgress } = options;
    try {
      signal?.throwIfAborted();
      const active = await this.store.active();
      if (!active) return { status: 'unconfigured', hits: [] };
      if (active.blocked) return { status: 'unavailable', hits: [] };
      const endpoint = await this.getEndpoint(active.choice);
      if (!endpoint) return { status: 'unavailable', hits: [] };
      const { queryPrefix, maxInputTokens, indexDimensions } = endpoint.model;
      let query = q.trim();
      const budget = maxInputTokens - Buffer.byteLength(queryPrefix) - 8;
      if (Buffer.byteLength(query) > budget) {
        if (!book) throw new SearchInputTooLong();
        let bytes = 0;
        let end = 0;
        for (const char of query) {
          bytes += Buffer.byteLength(char);
          if (bytes > budget) break;
          end += char.length;
        }
        query = query.slice(0, end).trimEnd();
      }
      if (!query) return { status: 'unavailable', hits: [] };
      const [vector] = await this.client.embed(endpoint, [queryPrefix + query], false, signal, onProgress);
      signal?.throwIfAborted();
      const hits = book ? await this.store.searchBook(active, vector, limit, book)
        : await this.store.search(active, vector, indexDimensions, limit, scope);
      const { state } = await this.store.status(active);
      const current = await this.store.active();
      return current?.generation === active.generation ? { status: state, hits }
        : { status: current ? 'indexing' : 'unconfigured', hits: [] };
    } catch (error) {
      if (error instanceof SearchInputTooLong) throw error;
      return { status: 'unavailable', hits: [] };
    }
  }

  router(): Router {
    const router = Router();
    router.post('/', async (req, res) => {
      const { q, limit = 20, scope } = req.body ?? {};
      if (typeof q !== 'string' || !q.trim() || q.length > 200 || q.includes('\0') || !Number.isInteger(limit) || limit < 1 || limit > 50
        || (scope !== undefined && !isSemanticScope(scope))) { res.sendStatus(400); return; }
      const controller = new AbortController();
      res.once('close', () => controller.abort());
      res.set('Cache-Control', 'no-store');
      try {
        const result = await this.search(q, { limit, scope, signal: controller.signal });
        if (!controller.signal.aborted) res.json(result);
      } catch {
        if (!controller.signal.aborted) res.sendStatus(400);
      }
    });
    return router;
  }
}
