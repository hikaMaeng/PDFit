/**
 * Standard background-task contract, shared by the scheduler on the main thread
 * and by task scripts running in worker threads.
 *
 * Every unit of work travels as a TaskEnvelope with the same shape. What the work
 * actually does lives in the module named by `script`, whose default export is a
 * TaskScript. Adding a new periodic job therefore means writing one script and one
 * PeriodicTaskDefinition; the queue, the worker pool, and the scheduler stay as is.
 */

export interface TaskEnvelope<Payload = unknown> {
  /** Unique per submission; correlates the worker's settlement message. */
  id: string;
  /** Task definition name, for example `thumbnail`. */
  type: string;
  /** Identity of the work item inside its type. `type` + `key` is unique in the queue. */
  key: string;
  /** File URL of an ES module whose default export is a TaskScript. */
  script: string;
  /** Structured-cloneable input handed to the script. */
  payload: Payload;
  /** Higher runs first; equal priorities run in submission order. */
  priority: number;
  /** The worker is terminated when a run exceeds this. */
  timeoutMs: number;
  enqueuedAt: number;
}

export interface TaskRunContext {
  id: string;
  type: string;
  key: string;
}

/** What a task script module must default-export. */
export interface TaskScript<Payload = unknown, Result = unknown> {
  run(payload: Payload, context: TaskRunContext): Promise<Result> | Result;
}

/** Identity helper that gives a task script its types. */
export function defineTask<Payload = unknown, Result = unknown>(script: TaskScript<Payload, Result>): TaskScript<Payload, Result> {
  return script;
}

export type TaskFailureCode = 'script-error' | 'timeout' | 'worker-exit';

export interface TaskFailure {
  code: TaskFailureCode;
  name: string;
  message: string;
  stack?: string;
}

export type TaskOutcome<Result = unknown> =
  | { ok: true; result: Result; durationMs: number }
  | { ok: false; error: TaskFailure; durationMs: number };

/** Main thread -> worker. */
export interface TaskRunMessage {
  kind: 'run';
  envelope: TaskEnvelope;
}

/** Worker -> main thread. */
export interface TaskSettledMessage {
  kind: 'settled';
  id: string;
  outcome: TaskOutcome;
}

export const DEFAULT_TASK_PRIORITY = 0;
/** Priority used when a user is waiting for the result right now. */
export const INTERACTIVE_TASK_PRIORITY = 100;
export const DEFAULT_TASK_TIMEOUT_MS = 120_000;

export function taskIdentity(type: string, key: string): string {
  return `${type}\u0000${key}`;
}
