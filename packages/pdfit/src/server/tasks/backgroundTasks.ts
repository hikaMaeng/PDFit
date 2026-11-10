import { TaskScheduler } from './taskScheduler.js';

/**
 * Runtime-neutral entry to the background task layer. Both the local runtime and a
 * hosted runtime build their scheduler here and then register their own jobs, so
 * the schedule, the queue, and the worker pool behave the same in every edition.
 */
export interface PdfitTaskSchedulerOptions {
  /** Time between plans; each plan empties the pending queue and refills it. Default one hour. */
  intervalMs?: number;
  /** Worker threads shared by every background job. Default 2. */
  concurrency?: number;
  /** Delay before the first plan after start. Default 30 seconds. */
  initialDelayMs?: number;
  /** Pause after each task before its worker takes the next one. Default 0. */
  cooldownMs?: number;
  /** Prefix for log lines. Default `tasks`. */
  logLabel?: string;
}

export const DEFAULT_TASK_INTERVAL_MS = 60 * 60 * 1000;
export const DEFAULT_TASK_CONCURRENCY = 2;
export const DEFAULT_TASK_INITIAL_DELAY_MS = 30_000;

export function createPdfitTaskScheduler(options: PdfitTaskSchedulerOptions = {}): TaskScheduler {
  const label = options.logLabel ?? 'tasks';
  return new TaskScheduler({
    intervalMs: options.intervalMs ?? DEFAULT_TASK_INTERVAL_MS,
    concurrency: options.concurrency ?? DEFAULT_TASK_CONCURRENCY,
    initialDelayMs: options.initialDelayMs ?? DEFAULT_TASK_INITIAL_DELAY_MS,
    cooldownMs: options.cooldownMs ?? 0,
    log: (message) => console.log(`[${label}] ${message}`),
  });
}

function readInteger(name: string, value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value === undefined || value === '' ? fallback : value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

/** Reads the scheduler settings every edition shares from its process environment. */
export function readPdfitTaskSchedulerEnvironment(env: Record<string, string | undefined>): Required<Omit<PdfitTaskSchedulerOptions, 'logLabel'>> {
  return {
    intervalMs: readInteger('PDFIT_TASK_INTERVAL_MINUTES', env.PDFIT_TASK_INTERVAL_MINUTES, 60, 1, 1440) * 60 * 1000,
    concurrency: readInteger('PDFIT_TASK_CONCURRENCY', env.PDFIT_TASK_CONCURRENCY, DEFAULT_TASK_CONCURRENCY, 1, 16),
    initialDelayMs: readInteger('PDFIT_TASK_INITIAL_DELAY_SECONDS', env.PDFIT_TASK_INITIAL_DELAY_SECONDS, 30, 0, 3600) * 1000,
    cooldownMs: readInteger('PDFIT_TASK_COOLDOWN_MS', env.PDFIT_TASK_COOLDOWN_MS, 0, 0, 60000),
  };
}
