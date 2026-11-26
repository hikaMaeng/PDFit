import { readServerSentData } from '../../common/protocol/server-sent-data.js';

export const AI_MODEL_REQUEST_TIMEOUT_MS = 20 * 60_000;
const MAX_COMPLETION_LENGTH = 256 * 1024;

export function chatCompletionsUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/chat/completions`;
  return url.toString();
}

type ModelOptions = {
  headers?: Record<string, string>;
  signal: AbortSignal;
  request?: typeof fetch;
  onHttpStatus?: (status: number) => void;
  onDelta?: (text: string) => void;
};

type Completion = {
  error?: unknown;
  choices?: Array<{
    index?: number;
    delta?: { content?: unknown };
    message?: { content?: unknown };
    finish_reason?: string | null;
  }>;
};

// See docs/api.md#ai-model-requests.
export async function streamAiCompletion(endpoint: string, payload: object, {
  headers: configuredHeaders, signal, request = fetch, onDelta, onHttpStatus,
}: ModelOptions): Promise<string> {
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
      for await (const data of readServerSentData(response.body)) {
        if (data.trim() === '[DONE]') { done = true; break; }
        if (!data.trim()) continue;
        const frame = JSON.parse(data) as Completion | null;
        if (!frame || frame.error) throw new Error('AI model returned a stream error');
        const choice = frame.choices?.find((item) => (item.index ?? 0) === 0);
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
