import { readServerSentData } from '../../common/protocol/server-sent-data.js';
import type { AiModelProgress } from '../../common/protocol/ai-model/index.js';

export const AI_MODEL_REQUEST_TIMEOUT_MS = 20 * 60_000;
export const AI_MODEL_PRIORITY = { background: 0, interactive: 1, foreground: 2 } as const;
const MAX_COMPLETION_LENGTH = 256 * 1024;

type QueueStats = { active: number; pending: number; limit: number };
type QueueEntry = { priority: number; start(stats: QueueStats): Promise<void> };
type ModelQueue = { limit: number; active: number; pending: QueueEntry[] };
const modelQueues = new Map<string, ModelQueue>();

function pumpModelQueue(key: string, queue: ModelQueue) {
  while (queue.active < queue.limit) {
    const entry = queue.pending.shift();
    if (!entry) break;
    queue.active += 1;
    void entry.start({ active: queue.active, pending: queue.pending.length, limit: queue.limit }).finally(() => {
      queue.active -= 1;
      pumpModelQueue(key, queue);
    });
  }
  if (queue.active === 0 && queue.pending.length === 0 && modelQueues.get(key) === queue) modelQueues.delete(key);
}

export function chatCompletionsUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/chat/completions`;
  return url.toString();
}

export function aiModelQueueKey(endpoint: string): string {
  const url = new URL(endpoint);
  return url.origin + url.pathname;
}

type ModelOptions = {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  queueSignal?: AbortSignal;
  concurrency?: number;
  priority?: number;
  timeoutMs?: number | (() => number);
  onQueued?: (stats: QueueStats) => void;
  onStarted?: (stats: QueueStats) => void;
  onProgress?: (phase: AiModelProgress) => void;
  request?: typeof fetch;
  onHttpStatus?: (status: number) => void;
  onDelta?: (text: string) => void;
  onReasoning?: () => void;
};

type Completion = {
  error?: unknown;
  choices?: Array<{
    index?: number;
    delta?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown };
    message?: { content?: unknown };
    finish_reason?: string | null;
  }>;
};

// See docs/api.md#ai-model-requests. A worker owns the slot until the body settles.
export async function streamAiCompletion(endpoint: string, payload: object, options: ModelOptions): Promise<string> {
  const { concurrency, queueSignal, priority = AI_MODEL_PRIORITY.background, onQueued, onStarted } = options;
  const waitingSignal = queueSignal ?? options.signal;
  waitingSignal?.throwIfAborted();
  const key = aiModelQueueKey(endpoint);
  const queue = modelQueues.get(key) ?? { limit: 1, active: 0, pending: [] };
  if (concurrency !== undefined && Number.isSafeInteger(concurrency) && concurrency > 0) queue.limit = concurrency;
  modelQueues.set(key, queue);
  return new Promise((resolve, reject) => {
    const entry: QueueEntry = {
      priority,
      async start(stats) {
        waitingSignal?.removeEventListener('abort', abortWaiting);
        try {
          const timeoutMs = typeof options.timeoutMs === 'function' ? options.timeoutMs() : options.timeoutMs ?? AI_MODEL_REQUEST_TIMEOUT_MS;
          const deadline = AbortSignal.timeout(timeoutMs);
          const signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline;
          onStarted?.(stats);
          options.onProgress?.('running');
          signal.throwIfAborted();
          resolve(await readAiCompletion(endpoint, payload, { ...options, signal }));
        } catch (error) { reject(error); }
      },
    };
    function abortWaiting() {
      const index = queue.pending.indexOf(entry);
      if (index < 0) return;
      queue.pending.splice(index, 1);
      reject(waitingSignal?.reason);
      pumpModelQueue(key, queue);
    }
    const firstLower = queue.pending.findIndex((pending) => pending.priority < priority);
    const position = firstLower < 0 ? queue.pending.length : firstLower;
    queue.pending.splice(position, 0, entry);
    waitingSignal?.addEventListener('abort', abortWaiting, { once: true });
    try {
      onQueued?.({ active: queue.active, pending: queue.pending.length, limit: queue.limit });
      if (queue.active + position >= queue.limit) options.onProgress?.('queued');
    }
    catch (error) {
      waitingSignal?.removeEventListener('abort', abortWaiting);
      const index = queue.pending.indexOf(entry);
      if (index >= 0) queue.pending.splice(index, 1);
      reject(error);
    }
    pumpModelQueue(key, queue);
  });
}

async function readAiCompletion(endpoint: string, payload: object, {
  headers: configuredHeaders, signal, request = fetch, onDelta, onHttpStatus, onReasoning,
}: ModelOptions & { signal: AbortSignal }): Promise<string> {
  let content = '';
  let finishReason: string | null = null;
  const keep = (text: unknown) => {
    if (typeof text !== 'string') return;
    const clean = text.replaceAll('\0', '');
    if (content.length + clean.length > MAX_COMPLETION_LENGTH) throw new Error('AI response exceeds the size limit');
    content += clean;
    if (clean) onDelta?.(clean);
  };

  const headers = Object.fromEntries(Object.entries(configuredHeaders ?? {}).filter(([name]) =>
    !/^(accept|content-type)$/i.test(name)));
  try {
    const response = await request(endpoint, {
      method: 'POST', headers: { ...headers, Accept: 'text/event-stream, application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, stream: true }), signal,
    });
    onHttpStatus?.(response.status);
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error(`AI model request failed (${response.status}).`);
    }
    if (/^text\/event-stream(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
      if (!response.body) throw new Error('AI model returned no stream');
      let done = false;
      let sawReasoning = false;
      for await (const data of readServerSentData(response.body)) {
        if (data.trim() === '[DONE]') { done = true; break; }
        if (!data.trim()) continue;
        const frame = JSON.parse(data) as Completion | null;
        if (!frame || frame.error) throw new Error('AI model returned a stream error');
        const choice = frame.choices?.find((item) => (item.index ?? 0) === 0);
        if (onReasoning && !sawReasoning && !content && (choice?.delta?.reasoning_content || choice?.delta?.reasoning)) {
          sawReasoning = true;
          onReasoning();
        }
        keep(choice?.delta?.content);
        if (choice?.finish_reason) finishReason = choice.finish_reason;
      }
      if (!done && !finishReason) throw new Error('AI stream ended before completion');
    } else {
      // Some compatible endpoints answer a streaming request with a complete JSON body.
      const frame = await response.json() as Completion | null;
      const choice = frame?.choices?.[0];
      if (frame?.error || typeof choice?.message?.content !== 'string') throw new Error('AI model returned no message');
      keep(choice.message.content);
      finishReason = choice.finish_reason ?? null;
    }
    if (finishReason && finishReason !== 'stop') throw new Error(`AI model did not finish normally (${finishReason}).`);
    return content;
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  }
}
