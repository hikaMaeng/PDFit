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
async function attempt(folder: string, filename: string, pageIndex: number, signal?: AbortSignal): Promise<PageOcrResult> {
  let response: Response;
  try {
    response = await fetch('/api/ocr/page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder, filename, pageIndex }),
      signal,
    });
  } catch (error) {
    // An aborted request is the caller's doing; anything else is a dead connection.
    if (signal?.aborted) throw error;
    throw new OcrUnreachableError(null);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    // A gateway answer carries no API error field: the request never reached the runtime.
    if (!payload?.error && GATEWAY_STATUSES.has(response.status)) throw new OcrUnreachableError(response.status);
    throw new Error(payload?.error ?? `HTTP ${response.status}`);
  }
  return response.json() as Promise<PageOcrResult>;
}

/**
 * Text of one page. A request that never reached the server is retried with a backoff,
 * so a page read across a restart recovers on its own instead of failing the dialog.
 */
export async function recognizePageText(folder: string, filename: string, pageIndex: number, signal?: AbortSignal): Promise<PageOcrResult> {
  for (let index = 0; ; index += 1) {
    try {
      return await attempt(folder, filename, pageIndex, signal);
    } catch (error) {
      if (!(error instanceof OcrUnreachableError) || index >= RETRY_DELAYS_MS.length) throw error;
      await sleep(RETRY_DELAYS_MS[index], signal);
    }
  }
}
