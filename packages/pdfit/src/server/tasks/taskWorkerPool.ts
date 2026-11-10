import { Worker, type ResourceLimits } from 'node:worker_threads';
import type { TaskEnvelope, TaskOutcome, TaskRunMessage, TaskSettledMessage } from './taskProtocol.js';

/** Minimal worker surface the pool needs; lets tests substitute a fake. */
export interface TaskWorkerLike {
  postMessage(message: TaskRunMessage): void;
  on(event: 'message', listener: (message: TaskSettledMessage) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  terminate(): Promise<unknown>;
  unref?(): void;
}

export interface TaskWorkerPoolOptions {
  /** Number of worker threads that may run tasks at the same time. */
  size: number;
  /** A worker with no work for this long is terminated, so an idle server holds no task threads. */
  idleTimeoutMs?: number;
  /** A worker is replaced after this many tasks, which bounds leaks inside task scripts. */
  maxTasksPerWorker?: number;
  resourceLimits?: ResourceLimits;
  createWorker?: () => TaskWorkerLike;
}

export interface TaskRunner {
  readonly size: number;
  readonly idleSlots: number;
  run(envelope: TaskEnvelope): Promise<TaskOutcome>;
  close(): Promise<void>;
}

interface Slot {
  worker?: TaskWorkerLike;
  busy: boolean;
  tasksRun: number;
  idleTimer?: ReturnType<typeof setTimeout>;
  /** Settles the task currently running in this slot. */
  settle?: (outcome: TaskOutcome) => void;
  currentId?: string;
}

// Compiled output runs `.js`; `tsx` development runs the `.ts` source directly.
const HOST_URL = new URL(import.meta.url.endsWith('.ts') ? './taskWorkerHost.ts' : './taskWorkerHost.js', import.meta.url);

/**
 * Fixed-size pool of worker threads that all run the shared task host. The size is
 * the parallelism budget for every background task type together.
 */
export class TaskWorkerPool implements TaskRunner {
  // One slot per unit of parallelism. Scope: this pool. Lifetime: until close().
  // Bound: `size`, fixed at construction.
  private readonly slots: Slot[];
  private readonly idleTimeoutMs: number;
  private readonly maxTasksPerWorker: number;
  private closed = false;

  constructor(private readonly options: TaskWorkerPoolOptions) {
    if (!Number.isInteger(options.size) || options.size < 1) throw new Error('TaskWorkerPool size must be a positive integer.');
    this.slots = Array.from({ length: options.size }, () => ({ busy: false, tasksRun: 0 }));
    this.idleTimeoutMs = options.idleTimeoutMs ?? 60_000;
    this.maxTasksPerWorker = options.maxTasksPerWorker ?? 200;
  }

  get size(): number {
    return this.slots.length;
  }

  get idleSlots(): number {
    return this.closed ? 0 : this.slots.filter((slot) => !slot.busy).length;
  }

  run(envelope: TaskEnvelope): Promise<TaskOutcome> {
    const slot = this.closed ? undefined : this.slots.find((candidate) => !candidate.busy);
    if (!slot) return Promise.reject(new Error('No idle task worker is available.'));
    slot.busy = true;
    if (slot.idleTimer) { clearTimeout(slot.idleTimer); slot.idleTimer = undefined; }
    const started = performance.now();

    return new Promise<TaskOutcome>((resolve) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const finish = (outcome: TaskOutcome, discardWorker: boolean) => {
        if (slot.settle !== settle) return;
        slot.settle = undefined;
        slot.currentId = undefined;
        if (timeout) clearTimeout(timeout);
        slot.tasksRun += 1;
        if (discardWorker || slot.tasksRun >= this.maxTasksPerWorker) this.discard(slot);
        slot.busy = false;
        if (slot.worker) this.armIdleTimer(slot);
        resolve(outcome);
      };
      const settle = (outcome: TaskOutcome) => finish(outcome, !outcome.ok && outcome.error.code !== 'script-error');
      slot.settle = settle;
      slot.currentId = envelope.id;

      try {
        const worker = this.ensureWorker(slot);
        timeout = setTimeout(() => {
          settle({ ok: false, error: { code: 'timeout', name: 'TaskTimeoutError', message: `Task ${envelope.type}:${envelope.key} exceeded ${envelope.timeoutMs}ms and its worker was terminated.` }, durationMs: performance.now() - started });
        }, envelope.timeoutMs);
        worker.postMessage({ kind: 'run', envelope });
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        settle({ ok: false, error: { code: 'worker-exit', name: failure.name, message: failure.message, stack: failure.stack }, durationMs: performance.now() - started });
      }
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.all(this.slots.map(async (slot) => {
      if (slot.idleTimer) { clearTimeout(slot.idleTimer); slot.idleTimer = undefined; }
      slot.settle?.({ ok: false, error: { code: 'worker-exit', name: 'TaskPoolClosedError', message: 'The task worker pool was closed.' }, durationMs: 0 });
      const worker = slot.worker;
      slot.worker = undefined;
      if (worker) await worker.terminate().catch(() => undefined);
    }));
  }

  private ensureWorker(slot: Slot): TaskWorkerLike {
    if (slot.worker) return slot.worker;
    const worker: TaskWorkerLike = this.options.createWorker?.() ?? new Worker(HOST_URL, { resourceLimits: this.options.resourceLimits });
    slot.worker = worker;
    slot.tasksRun = 0;
    worker.on('message', (message) => {
      if (slot.worker !== worker || message?.kind !== 'settled' || message.id !== slot.currentId) return;
      slot.settle?.(message.outcome);
    });
    worker.on('error', (error) => {
      if (slot.worker !== worker) return;
      slot.settle?.({ ok: false, error: { code: 'worker-exit', name: error.name, message: error.message, stack: error.stack }, durationMs: 0 });
      if (slot.worker === worker) this.discard(slot);
    });
    worker.on('exit', (code) => {
      if (slot.worker !== worker) return;
      slot.settle?.({ ok: false, error: { code: 'worker-exit', name: 'TaskWorkerExitError', message: `Task worker exited with code ${code} before settling.` }, durationMs: 0 });
      if (slot.worker === worker) slot.worker = undefined;
    });
    return worker;
  }

  private discard(slot: Slot): void {
    const worker = slot.worker;
    slot.worker = undefined;
    if (slot.idleTimer) { clearTimeout(slot.idleTimer); slot.idleTimer = undefined; }
    if (worker) void worker.terminate().catch(() => undefined);
  }

  private armIdleTimer(slot: Slot): void {
    slot.idleTimer = setTimeout(() => {
      slot.idleTimer = undefined;
      if (!slot.busy) this.discard(slot);
    }, this.idleTimeoutMs);
    slot.idleTimer.unref?.();
  }
}
