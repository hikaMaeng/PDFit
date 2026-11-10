/**
 * Worker-thread entry shared by every task type. It receives standard envelopes,
 * loads the task script named by the envelope (once per worker), runs it, and
 * reports a standard outcome. One task runs at a time; the pool enforces that.
 */
import { parentPort } from 'node:worker_threads';
import type { TaskRunMessage, TaskScript, TaskSettledMessage } from './taskProtocol.js';

if (!parentPort) throw new Error('taskWorkerHost must run inside a worker thread.');
const port = parentPort;

// Loaded task scripts keyed by module URL. Scope: this worker thread. Lifetime: until
// the pool recycles or terminates the worker. Bound: the number of registered task types.
const scripts = new Map<string, Promise<TaskScript>>();

function loadScript(url: string): Promise<TaskScript> {
  let loading = scripts.get(url);
  if (!loading) {
    loading = import(url).then((module: { default?: TaskScript }) => {
      const script = module.default;
      if (!script || typeof script.run !== 'function') throw new Error(`Task script ${url} must default-export an object with run().`);
      return script;
    });
    scripts.set(url, loading);
    loading.catch(() => scripts.delete(url));
  }
  return loading;
}

port.on('message', (message: TaskRunMessage) => {
  if (message?.kind !== 'run') return;
  const { envelope } = message;
  const started = performance.now();
  const settle = (outcome: TaskSettledMessage['outcome']) => port.postMessage({ kind: 'settled', id: envelope.id, outcome } satisfies TaskSettledMessage);
  void loadScript(envelope.script)
    .then((script) => script.run(envelope.payload, { id: envelope.id, type: envelope.type, key: envelope.key }))
    .then(
      (result) => {
        try {
          settle({ ok: true, result, durationMs: performance.now() - started });
        } catch (error) {
          // A result that cannot be structured-cloned must still settle the task.
          settle({ ok: false, error: { code: 'script-error', name: 'DataCloneError', message: `Task result is not transferable: ${String(error)}` }, durationMs: performance.now() - started });
        }
      },
      (error: unknown) => {
        const failure = error instanceof Error ? error : new Error(String(error));
        settle({ ok: false, error: { code: 'script-error', name: failure.name, message: failure.message, stack: failure.stack }, durationMs: performance.now() - started });
      },
    );
});
