import type { OcrScanJob } from '../../common/protocol/ocr/scan.js';
import { AI_MODEL_PROGRESS_MEDIA_TYPE, type AiModelProgress } from '../../common/protocol/ai-model/index.js';
import { readAiProgressResponse } from './aiProgress.js';

/** Page OCR (local runtime): the PDF text layer, else the Settings vision model. */
export interface PageOcrResult {
  text: string;
  source: 'text-layer' | 'vision' | 'none';
  cached: boolean;
  pageIndex: number;
  pageCount: number;
  durationMs: number;
}

/**
 * A page request that never reached the server: the runtime was restarting, or a reverse
 * proxy in front of it answered for a backend it could not connect to (a 502/503/504 whose
 * body is not this API's JSON). The caller shows its own wording instead of `HTTP 502`.
 */
export class OcrUnreachableError extends Error {
  readonly status: number | null;
  constructor(status: number | null) {
    super(status === null ? 'The server could not be reached.' : `The server could not be reached (HTTP ${status}).`);
    this.name = 'OcrUnreachableError';
    this.status = status;
  }
}

/** Backoff between attempts, in ms. Spans ~30 s, which covers a container restart. */
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];
const GATEWAY_STATUSES = new Set([502, 503, 504]);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); return; }
    const timer = window.setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    function onAbort() { window.clearTimeout(timer); reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')); }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** One attempt. Rejects with OcrUnreachableError when the server itself did not answer. */
async function requestPageOcr(url: string, init: RequestInit, onProgress?: (phase: AiModelProgress) => void): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    // An aborted request is the caller's doing; anything else is a dead connection.
    if (init.signal?.aborted) throw error;
    throw new OcrUnreachableError(null);
  }
  response = await readAiProgressResponse(response, onProgress);
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    // A gateway answer carries no API error field: the request never reached the runtime.
    if (!payload?.error && GATEWAY_STATUSES.has(response.status)) throw new OcrUnreachableError(response.status);
    throw new Error(payload?.error ?? `HTTP ${response.status}`);
  }
  return response;
}

export async function getCachedPageText(folder: string, filename: string, pageIndex: number, signal: AbortSignal): Promise<PageOcrResult | null> {
  const query = new URLSearchParams({ folder, filename, pageIndex: String(pageIndex) });
  const response = await requestPageOcr(`/api/ocr/page?${query}`, { signal });
  return response.status === 204 ? null : response.json() as Promise<PageOcrResult>;
}

/**
 * Text of one page. A request that never reached the server is retried with a backoff,
 * so a page read across a restart recovers on its own instead of failing the dialog.
 */
export async function recognizePageText(folder: string, filename: string, pageIndex: number, signal?: AbortSignal, onProgress?: (phase: AiModelProgress) => void): Promise<PageOcrResult> {
  for (let index = 0; ; index += 1) {
    try {
      const response = await requestPageOcr('/api/ocr/page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: AI_MODEL_PROGRESS_MEDIA_TYPE },
        body: JSON.stringify({ folder, filename, pageIndex }),
        signal,
      }, onProgress);
      return await response.json() as PageOcrResult;
    } catch (error) {
      if (!(error instanceof OcrUnreachableError) || index >= RETRY_DELAYS_MS.length) throw error;
      await sleep(RETRY_DELAYS_MS[index], signal);
    }
  }
}


export interface OcrScanBook { folder: string; filename: string }

async function requestScan<T>(path: string, init?: RequestInit): Promise<T> {
  const timeout = AbortSignal.timeout(15_000);
  const signal = init?.signal ? AbortSignal.any([timeout, init.signal]) : timeout;
  const response = await fetch(`/api/ocr/scan${path}`, { ...init, signal });
  if (!response.ok) throw new Error(`Scan request failed (${response.status}).`);
  return response.json() as Promise<T>;
}

export function getOcrScan(book: OcrScanBook) {
  return requestScan<{ job: OcrScanJob | null }>(`?${new URLSearchParams({ ...book })}`);
}

export function listOcrScanPages(book: OcrScanBook, signal?: AbortSignal) {
  return requestScan<{ pages: number[] }>(`/pages?${new URLSearchParams({ ...book })}`, { signal });
}

export function changeOcrScan(book: OcrScanBook, change: { startPage: number } | { id: string }) {
  return requestScan<{ job: OcrScanJob | null }>('id' in change ? '/cancel' : '', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...book, ...change }),
  });
}
