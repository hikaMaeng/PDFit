import { randomUUID } from 'node:crypto';
import { TaskQueue, type TaskSubmitResult } from './taskQueue.js';
import { DEFAULT_TASK_PRIORITY, DEFAULT_TASK_TIMEOUT_MS, taskIdentity, type TaskEnvelope, type TaskOutcome } from './taskProtocol.js';
import { TaskWorkerPool, type TaskRunner } from './taskWorkerPool.js';

export interface PlannedTask<Payload = unknown> {
  /** Identity of the work item inside its task type. */
  key: string;
  payload: Payload;
  priority?: number;
}

/**
 * A periodic job. `plan` recomputes everything this job currently has to do; the
 * scheduler queues the result and worker threads run `script` once per planned item.
 */
export interface PeriodicTaskDefinition<Payload = unknown, Result = unknown> {
  type: string;
  /** ES module whose default export is a TaskScript for this job. */
  script: URL | string;
  timeoutMs?: number;
  plan(): Promise<PlannedTask<Payload>[]>;
  /**
   * Runs on the main thread just before a task is handed to a worker and returns the
   * payload the worker receives. Use it for inputs that must be fresh at run time,
   * such as a short-lived access ticket, instead of storing them in the queue.
   */
  prepare?(task: TaskEnvelope<Payload>): Promise<unknown> | unknown;
  /** Runs on the main thread after each task settles, before its slot is reused. */
  onSettled?(task: TaskEnvelope<Payload>, outcome: TaskOutcome<Result>): void | Promise<void>;
}

export interface TaskSchedulerOptions {
  /** Time between plans. Each plan empties the pending queue and refills it. */
  intervalMs: number;
  /** Worker threads shared by all task types. Ignored when `runner` is given. */
  concurrency: number;
  /** Delay before the first plan after `start()`. */
  initialDelayMs?: number;
  /** Pause after each task before its slot takes the next one. */
  cooldownMs?: number;
  runner?: TaskRunner;
  log?: (message: string) => void;
  now?: () => number;
}

export interface TaskTypeStatus {
  type: string;
  /** Tasks the latest plan produced. */
  planned: number;
  pending: number;
  running: number;
  completedSincePlan: number;
  failedSincePlan: number;
  completedTotal: number;
  failedTotal: number;
  lastPlanAt: string | null;
  lastPlanDurationMs: number | null;
  lastPlanError: string | null;
  recentFailures: Array<{ key: string; code: string; message: string; at: string }>;
}

export interface TaskSchedulerStatus {
  running: boolean;
  intervalMs: number;
  concurrency: number;
  cooldownMs: number;
  planCount: number;
  planning: boolean;
  nextPlanAt: string | null;
  pending: number;
  active: number;
  types: TaskTypeStatus[];
}

export type TaskSubmitOutcome = TaskSubmitResult | 'running' | 'unknown-type';

interface TypeState {
  definition: PeriodicTaskDefinition;
  planned: number;
  completedSincePlan: number;
  failedSincePlan: number;
  completedTotal: number;
  failedTotal: number;
  lastPlanAt: number | null;
  lastPlanDurationMs: number | null;
  lastPlanError: string | null;
  /** Newest last. Bound: MAX_RECENT_FAILURES entries; reset by every successful plan. */
  recentFailures: Array<{ key: string; code: string; message: string; at: number }>;
}

const MAX_RECENT_FAILURES = 20;

/**
 * Runs registered periodic jobs on one shared queue and one shared worker pool.
 *
 * Every `intervalMs` the scheduler asks each definition for its current work,
 * drops whatever that type still had pending, and queues the new plan. Tasks that
 * are already running are left to finish and are not queued a second time.
 */
export class TaskScheduler {
  private readonly queue = new TaskQueue();
  private readonly runner: TaskRunner;
  private readonly ownsRunner: boolean;
  private readonly log: (message: string) => void;
  private readonly now: () => number;
  private readonly cooldownMs: number;
  // Registered jobs by type. Scope: this scheduler. Lifetime: until the process ends.
  // Bound: one entry per register() call; nothing removes entries.
  private readonly types = new Map<string, TypeState>();
  // Tasks currently in a worker, by task identity. Scope: this scheduler. Lifetime: from
  // dispatch until the outcome is handled. Bound: the runner's size. Cleared as each task settles.
  private readonly running = new Map<string, TaskEnvelope>();
  // Slots resting between tasks; counted against the parallelism budget. Bound: runner size.
  private cooling = 0;
  // Slots reserved by tasks whose prepare() is still running. Bound: runner size.
  private preparing = 0;
  private firstTimer: ReturnType<typeof setTimeout> | undefined;
  private intervalTimer: ReturnType<typeof setInterval> | undefined;
  private started = false;
  private planning: Promise<void> | null = null;
  private planCount = 0;
  private nextPlanAt: number | null = null;
  private idleWaiters: Array<() => void> = [];

  constructor(private readonly options: TaskSchedulerOptions) {
    if (!(options.intervalMs > 0)) throw new Error('TaskScheduler intervalMs must be positive.');
    this.ownsRunner = !options.runner;
    this.runner = options.runner ?? new TaskWorkerPool({ size: options.concurrency });
    this.log = options.log ?? (() => undefined);
    this.now = options.now ?? Date.now;
    this.cooldownMs = Math.max(0, options.cooldownMs ?? 0);
  }

  register<Payload, Result>(definition: PeriodicTaskDefinition<Payload, Result>): void {
    if (this.types.has(definition.type)) throw new Error(`Task type ${definition.type} is already registered.`);
    this.types.set(definition.type, {
      definition: definition as unknown as PeriodicTaskDefinition,
      planned: 0, completedSincePlan: 0, failedSincePlan: 0, completedTotal: 0, failedTotal: 0,
      lastPlanAt: null, lastPlanDurationMs: null, lastPlanError: null, recentFailures: [],
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const initialDelayMs = Math.max(0, this.options.initialDelayMs ?? 0);
    this.nextPlanAt = this.now() + initialDelayMs;
    this.firstTimer = setTimeout(() => {
      this.firstTimer = undefined;
      this.nextPlanAt = this.now() + this.options.intervalMs;
      void this.planNow();
      this.intervalTimer = setInterval(() => {
        this.nextPlanAt = this.now() + this.options.intervalMs;
        void this.planNow();
      }, this.options.intervalMs);
      this.intervalTimer.unref?.();
    }, initialDelayMs);
    this.firstTimer.unref?.();
  }

  /** Stops planning, drops pending work, and closes a pool this scheduler created. */
  async stop(): Promise<void> {
    this.started = false;
    if (this.firstTimer) clearTimeout(this.firstTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.firstTimer = undefined;
    this.intervalTimer = undefined;
    this.nextPlanAt = null;
    this.queue.clear();
    if (this.ownsRunner) await this.runner.close();
  }

  /** Recomputes every registered job's queue now. Overlapping calls share one plan. */
  planNow(): Promise<void> {
    if (!this.planning) {
      this.planning = this.plan().finally(() => { this.planning = null; this.pump(); });
    }
    return this.planning;
  }

  /** Queues one task outside the periodic plan, for example when a user is waiting for it. */
  submit(type: string, task: PlannedTask): TaskSubmitOutcome {
    const state = this.types.get(type);
    if (!state) return 'unknown-type';
    if (this.running.has(taskIdentity(type, task.key))) return 'running';
    const result = this.queue.submit(this.envelope(state.definition, task));
    if (result === 'queued' || result === 'promoted') this.pump();
    return result;
  }

  /** Resolves when nothing is pending, running, cooling down, or being planned. */
  whenIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  status(): TaskSchedulerStatus {
    return {
      running: this.started,
      intervalMs: this.options.intervalMs,
      concurrency: this.runner.size,
      cooldownMs: this.cooldownMs,
      planCount: this.planCount,
      planning: this.planning !== null,
      nextPlanAt: this.nextPlanAt === null ? null : new Date(this.nextPlanAt).toISOString(),
      pending: this.queue.size,
      active: this.running.size,
      types: [...this.types.values()].map((state) => ({
        type: state.definition.type,
        planned: state.planned,
        pending: this.queue.sizeOf(state.definition.type),
        running: [...this.running.values()].filter((envelope) => envelope.type === state.definition.type).length,
        completedSincePlan: state.completedSincePlan,
        failedSincePlan: state.failedSincePlan,
        completedTotal: state.completedTotal,
        failedTotal: state.failedTotal,
        lastPlanAt: state.lastPlanAt === null ? null : new Date(state.lastPlanAt).toISOString(),
        lastPlanDurationMs: state.lastPlanDurationMs,
        lastPlanError: state.lastPlanError,
        recentFailures: state.recentFailures.map((failure) => ({ ...failure, at: new Date(failure.at).toISOString() })),
      })),
    };
  }

  private async plan(): Promise<void> {
    this.planCount += 1;
    for (const state of this.types.values()) {
      const { definition } = state;
      const started = this.now();
      try {
        const planned = await definition.plan();
        // A task still in a worker from the previous plan finishes there; queueing it again would run it twice.
        const envelopes = planned
          .filter((task) => !this.running.has(taskIdentity(definition.type, task.key)))
          .map((task) => this.envelope(definition, task));
        const { dropped, queued, rejected } = this.queue.replaceType(definition.type, envelopes);
        state.planned = planned.length;
        state.completedSincePlan = 0;
        state.failedSincePlan = 0;
        state.recentFailures = [];
        state.lastPlanError = null;
        this.log(`plan ${definition.type}: ${planned.length} planned, ${queued} queued, ${dropped} dropped from the previous queue${rejected ? `, ${rejected} rejected (queue full)` : ''}`);
      } catch (error) {
        // A plan that cannot be computed (for example an unreachable library volume)
        // leaves the previous queue in place rather than discarding known work.
        state.lastPlanError = error instanceof Error ? error.message : String(error);
        this.log(`plan ${definition.type} failed: ${state.lastPlanError}`);
      }
      state.lastPlanAt = started;
      state.lastPlanDurationMs = this.now() - started;
      this.pump();
    }
  }

  private envelope(definition: PeriodicTaskDefinition, task: PlannedTask): TaskEnvelope {
    return {
      id: randomUUID(),
      type: definition.type,
      key: task.key,
      script: String(definition.script),
      payload: task.payload,
      priority: task.priority ?? DEFAULT_TASK_PRIORITY,
      timeoutMs: definition.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS,
      enqueuedAt: this.now(),
    };
  }

  private pump(): void {
    while (this.runner.idleSlots - this.cooling - this.preparing > 0) {
      const envelope = this.queue.take();
      if (!envelope) break;
      const identity = taskIdentity(envelope.type, envelope.key);
      this.running.set(identity, envelope);
      void this.dispatch(envelope).then((outcome) => this.settled(identity, envelope, outcome));
    }
    this.notifyIdle();
  }

  private async dispatch(envelope: TaskEnvelope): Promise<TaskOutcome> {
    let toRun = envelope;
    const prepare = this.types.get(envelope.type)?.definition.prepare;
    if (prepare) {
      this.preparing += 1;
      try {
        toRun = { ...envelope, payload: await prepare(envelope) };
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        return { ok: false, error: { code: 'script-error', name: 'TaskPrepareError', message: failure.message, stack: failure.stack }, durationMs: 0 };
      } finally {
        this.preparing -= 1;
      }
    }
    try {
      return await this.runner.run(toRun);
    } catch (error) {
      return { ok: false, error: { code: 'worker-exit', name: 'TaskDispatchError', message: error instanceof Error ? error.message : String(error) }, durationMs: 0 };
    }
  }

  private async settled(identity: string, envelope: TaskEnvelope, outcome: TaskOutcome): Promise<void> {
    const state = this.types.get(envelope.type);
    if (state) {
      if (outcome.ok) {
        state.completedSincePlan += 1;
        state.completedTotal += 1;
      } else {
        state.failedSincePlan += 1;
        state.failedTotal += 1;
        state.recentFailures.push({ key: envelope.key, code: outcome.error.code, message: outcome.error.message, at: this.now() });
        if (state.recentFailures.length > MAX_RECENT_FAILURES) state.recentFailures.shift();
      }
      try {
        await state.definition.onSettled?.(envelope, outcome);
      } catch (error) {
        this.log(`onSettled ${envelope.type}:${envelope.key} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.running.delete(identity);
    if (this.cooldownMs > 0 && this.queue.size > 0) {
      this.cooling += 1;
      const timer = setTimeout(() => { this.cooling -= 1; this.pump(); }, this.cooldownMs);
      timer.unref?.();
      return;
    }
    this.pump();
  }

  private isIdle(): boolean {
    return this.queue.size === 0 && this.running.size === 0 && this.cooling === 0 && this.preparing === 0 && this.planning === null;
  }

  private notifyIdle(): void {
    if (!this.isIdle() || this.idleWaiters.length === 0) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }
}
