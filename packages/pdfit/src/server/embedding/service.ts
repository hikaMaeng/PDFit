import { Router } from 'express';
import { isSemanticScope, type ModelChoice, type SemanticSearchResult } from '../../common/protocol/embedding-search/index.js';
import type { TaskScheduler } from '../tasks/taskScheduler.js';
import type { ChunkBatch, PlannedChunk } from './chunks.worker.js';
import { EmbeddingClient, EmbeddingUpstreamError, embeddingBatchWidth, type EmbeddingEndpoint } from './client.js';
import { EmbeddingStore, type ActiveIndex, type ReservedWork } from './store.js';

const TASK = 'embedding-index';
const SLICES_PER_PERIOD = 256;

export class EmbeddingService {
  private scheduler?: TaskScheduler;
  private remaining = 0;
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
      plan: async () => { this.wake(); return []; },
      onSettled: (_task, outcome) => {
        // Returning synchronously frees the shared worker before any remote I/O.
        void this.finish(outcome.ok ? outcome.result : null);
      },
      onCapacity: () => this.submitPending(),
    });
  }

  wake(): void {
    this.remaining = SLICES_PER_PERIOD;
    void this.slice();
  }

  private submitPending(): void {
    if (!this.pendingWorker || !this.scheduler) return;
    const submitted = this.scheduler.submit(TASK, { key: 'chunks', payload: this.pendingWorker, priority: -1 });
    if (submitted === 'queued') this.pendingWorker = undefined;
  }

  private async slice(): Promise<void> {
    if (!this.scheduler || this.working || this.remaining <= 0) return;
    this.working = true;
    this.remaining -= 1;
    let more = false;
    try {
      const active = await this.store.active();
      const cleanup = await this.store.cleanup();
      if (active && !active.blocked) {
        const endpoint = await this.getEndpoint(active.choice);
        if (!endpoint) throw new Error('Selected embedding model is unavailable');
        const refilled = await this.store.refill(active);
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
    if (more) setImmediate(() => void this.slice());
  }

  private async finish(plan: PlannedChunk[] | null): Promise<void> {
    const reservation = this.reservation;
    if (!reservation) return;
    const { active, endpoint, work } = reservation;
    try {
      if (!plan) throw new Error('Could not split embedding input');
      if ((await this.store.active())?.generation !== active.generation) {
        await this.store.release(active, work);
        return;
      }
      const texts = plan.filter(({ chunk }) => chunk.contents.trim()).map(({ chunk }) => endpoint.model.documentPrefix + chunk.contents);
      const vectors = texts.length ? await this.embedBatch(endpoint, texts) : [];
      let index = 0;
      const invalid = new Set<string>();
      const items = plan.map(({ chunk, job }) => {
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
      }
      catch { /* The durable reservation can be acquired after its expiry. */ }
      if (permanent || upstream?.status === 429) this.remaining = 0;
    } finally {
      this.reservation = undefined;
      this.working = false;
      setImmediate(() => void this.slice());
    }
  }

  private async embedBatch(endpoint: EmbeddingEndpoint, texts: string[]): Promise<(number[] | null)[]> {
    try { return await this.client.embed(endpoint, texts, true); }
    catch (error) {
      if (!(error instanceof EmbeddingUpstreamError) || ![400, 413, 422].includes(error.status)) throw error;
      if (texts.length === 1) return [null];
      const middle = Math.floor(texts.length / 2);
      const first = await this.embedBatch(endpoint, texts.slice(0, middle));
      return first.concat(await this.embedBatch(endpoint, texts.slice(middle)));
    }
  }

  async status() {
    const status = await this.store.status(await this.store.active());
    return { ...status, lastError: this.lastError };
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
      let result: SemanticSearchResult = { status: 'unconfigured', hits: [] };
      try {
        const active = await this.store.active();
        if (active?.blocked) result = { status: 'unavailable', hits: [] };
        else if (active) {
          const endpoint = await this.getEndpoint(active.choice);
          if (!endpoint) throw new Error('Embedding model is unavailable');
          const input = endpoint.model.queryPrefix + q.trim();
          if (Buffer.byteLength(input) + 8 > endpoint.model.maxInputTokens) { res.sendStatus(400); return; }
          const [vector] = await this.client.embed(endpoint, [input], false, controller.signal);
          controller.signal.throwIfAborted();
          const hits = await this.store.search(active, vector, endpoint.model.indexDimensions, limit, scope);
          const { state } = await this.store.status(active);
          const current = await this.store.active();
          result = current?.generation === active.generation ? { status: state, hits }
            : { status: current ? 'indexing' : 'unconfigured', hits: [] };
        }
      } catch { result = { status: 'unavailable', hits: [] }; }
      if (!controller.signal.aborted) res.json(result);
    });
    return router;
  }
}
