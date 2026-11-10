import { taskIdentity, type TaskEnvelope } from './taskProtocol.js';

export type TaskSubmitResult = 'queued' | 'promoted' | 'duplicate' | 'full';

/**
 * Pending-task queue: highest priority first, submission order within a priority.
 *
 * State: `buckets` maps a priority to its pending envelopes (insertion ordered),
 * `index` maps a task identity (`type` + `key`) to the priority bucket holding it.
 * Scope: one scheduler instance. Lifetime: an entry lives until it is taken, its
 * type is replaced by the next plan, or the queue is cleared. Bound: `maxPending`
 * entries in total; submissions beyond it are rejected with `full`. Cleared by
 * `replaceType` (every scheduler tick) and `clear` (scheduler stop).
 */
export class TaskQueue {
  private readonly buckets = new Map<number, Map<string, TaskEnvelope>>();
  private readonly index = new Map<string, number>();

  constructor(private readonly maxPending = 100_000) {}

  get size(): number {
    return this.index.size;
  }

  sizeOf(type: string): number {
    let count = 0;
    for (const bucket of this.buckets.values()) {
      for (const envelope of bucket.values()) if (envelope.type === type) count += 1;
    }
    return count;
  }

  has(type: string, key: string): boolean {
    return this.index.has(taskIdentity(type, key));
  }

  /** Adds a task. An already queued identity keeps its place unless the new priority is higher. */
  submit(envelope: TaskEnvelope): TaskSubmitResult {
    const identity = taskIdentity(envelope.type, envelope.key);
    const currentPriority = this.index.get(identity);
    if (currentPriority !== undefined) {
      if (envelope.priority <= currentPriority) return 'duplicate';
      this.buckets.get(currentPriority)?.delete(identity);
      this.insert(identity, envelope);
      return 'promoted';
    }
    if (this.index.size >= this.maxPending) return 'full';
    this.insert(identity, envelope);
    return 'queued';
  }

  /** Drops every pending task of `type` and queues `envelopes` instead. */
  replaceType(type: string, envelopes: TaskEnvelope[]): { dropped: number; queued: number; rejected: number } {
    let dropped = 0;
    for (const [priority, bucket] of this.buckets) {
      for (const [identity, envelope] of bucket) {
        if (envelope.type !== type) continue;
        bucket.delete(identity);
        this.index.delete(identity);
        dropped += 1;
      }
      if (bucket.size === 0) this.buckets.delete(priority);
    }
    let queued = 0;
    let rejected = 0;
    for (const envelope of envelopes) {
      const result = this.submit(envelope);
      if (result === 'queued') queued += 1;
      else if (result === 'full') rejected += 1;
    }
    return { dropped, queued, rejected };
  }

  /** Removes and returns the next task to run. */
  take(): TaskEnvelope | undefined {
    let best: number | undefined;
    for (const [priority, bucket] of this.buckets) {
      if (bucket.size > 0 && (best === undefined || priority > best)) best = priority;
    }
    if (best === undefined) return undefined;
    const bucket = this.buckets.get(best)!;
    const [identity, envelope] = bucket.entries().next().value as [string, TaskEnvelope];
    bucket.delete(identity);
    if (bucket.size === 0) this.buckets.delete(best);
    this.index.delete(identity);
    return envelope;
  }

  clear(): number {
    const dropped = this.index.size;
    this.buckets.clear();
    this.index.clear();
    return dropped;
  }

  private insert(identity: string, envelope: TaskEnvelope): void {
    let bucket = this.buckets.get(envelope.priority);
    if (!bucket) {
      bucket = new Map();
      this.buckets.set(envelope.priority, bucket);
    }
    bucket.set(identity, envelope);
    this.index.set(identity, envelope.priority);
  }
}
