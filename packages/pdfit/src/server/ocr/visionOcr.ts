import { AI_MODEL_PRIORITY, AI_MODEL_REQUEST_TIMEOUT_MS, chatCompletionsUrl, streamAiCompletion } from '../services/aiModelRequest.js';
import type { AiModelProgress } from '../../common/protocol/ai-model/index.js';

/**
 * OCR through an OpenAI-compatible vision model. Used only for areas that have no PDF
 * text layer (scanned pages); digital PDFs are read from the text layer instead.
 */
export interface VisionOcrServer {
  baseUrl: string;
  model: string;
  headers?: Record<string, string>;
  /** Maximum simultaneous OCR requests to this endpoint. */
  ocrConcurrency?: number;
  /** Local reasoning models can need minutes per image. */
  timeoutMs?: number;
}

export type VisionImageType = 'image/jpeg' | 'image/png' | 'image/webp';
type VisionOcrTrace = (phase: 'vision-queued' | 'vision-request' | 'vision-response', details: Record<string, unknown>) => void;

export function visionOcrConcurrency(server: VisionOcrServer | null): number {
  const limit = server?.ocrConcurrency ?? 1;
  return Number.isSafeInteger(limit) && limit > 0 ? limit : 1;
}

const OCR_INSTRUCTION = [
  'Transcribe every piece of text visible in this image exactly as written, in its original language.',
  'Keep the reading order and line breaks. Do not translate, summarize, explain, or add anything.',
  'Output only the transcribed text. If the image contains no text, output nothing.',
].join(' ');

/** Removes a wrapping code fence some models add around plain output. */
export function cleanOcrOutput(content: string): string {
  return content.replace(/^\s*```[a-z]*\s*\n?/i, '').replace(/\n?\s*```\s*$/, '').replace(/\r\n/g, '\n').trim();
}

export async function recognizeImageText(
  server: VisionOcrServer,
  image: { bytes: Buffer; type: VisionImageType },
  request: typeof fetch = fetch,
  trace?: VisionOcrTrace,
  priority: number = AI_MODEL_PRIORITY.background,
  queueSignal?: AbortSignal,
  onProgress?: (phase: AiModelProgress) => void,
): Promise<string> {
  const endpoint = chatCompletionsUrl(server.baseUrl);
  const timeoutMs = server.timeoutMs ?? AI_MODEL_REQUEST_TIMEOUT_MS;
  const content = await streamAiCompletion(endpoint, {
    model: server.model,
    temperature: 0,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: OCR_INSTRUCTION },
        { type: 'image_url', image_url: { url: `data:${image.type};base64,${image.bytes.toString('base64')}` } },
      ],
    }],
  }, {
    headers: server.headers,
    request,
    timeoutMs, concurrency: visionOcrConcurrency(server), priority, queueSignal, onProgress,
    onQueued: trace && (({ active, pending, limit }) =>
      trace('vision-queued', { visionActive: active, visionPending: pending, visionLimit: limit })),
    onStarted: trace && (({ active, pending, limit }) =>
      trace('vision-request', { endpoint: new URL(endpoint).origin, model: server.model, timeoutMs,
        visionActive: active, visionPending: pending, visionLimit: limit })),
    onHttpStatus: (httpStatus) => trace?.('vision-response', { httpStatus }),
  });
  return cleanOcrOutput(content);
}
