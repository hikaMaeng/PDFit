import type { EmbeddingModel } from '../../common/protocol/embedding-search/index.js';
import type { AiModelProgress } from '../../common/protocol/ai-model/index.js';

export interface EmbeddingEndpoint {
  model: EmbeddingModel;
  baseUrl: string;
  headers: Record<string, string>;
}

export class EmbeddingUpstreamError extends Error {
  constructor(readonly status: number, readonly retryAt?: number) { super(`Embedding provider error (${status})`); }
}

export const EMBEDDING_REQUEST_BYTES = 48 * 1024;
const RESPONSE_BYTES = 8 * 1024 * 1024;

export function embeddingBatchWidth(model: EmbeddingModel): number {
  return Math.min(model.embeddingConcurrency, Math.max(1, Math.floor(32_768 / model.dimensions)), 32);
}

function parseVectors(data: unknown, count: number, dimensions: number, indexDimensions: number): number[][] {
  const rows = (data as { data?: unknown })?.data;
  if (!Array.isArray(rows) || rows.length !== count) throw new EmbeddingUpstreamError(502);
  const output = new Array<number[]>(count);
  for (const row of rows) {
    const index = row?.index;
    const vector: unknown = row?.embedding;
    if (!Number.isInteger(index) || index < 0 || index >= count || output[index] || !Array.isArray(vector)
      || vector.length !== dimensions || vector.some((value) => typeof value !== 'number' || !Number.isFinite(Math.fround(value)))
      || !vector.slice(0, indexDimensions).some((value) => Math.fround(value) !== 0)) throw new EmbeddingUpstreamError(502);
    output[index] = vector;
  }
  return output;
}

/** One in-flight embeddings request across activation checks, searches and indexing. */
export class EmbeddingClient {
  private running = false;
  private readonly pending: { priority: number; start: () => Promise<void> }[] = [];

  constructor(private readonly request: typeof fetch = fetch) {}

  embed(endpoint: EmbeddingEndpoint, input: string[], background = false, signal?: AbortSignal,
    onProgress?: (phase: AiModelProgress) => void): Promise<number[][]> {
    const body = JSON.stringify({ model: endpoint.model.name, input });
    if (!input.length || input.length > embeddingBatchWidth(endpoint.model) || Buffer.byteLength(body) > EMBEDDING_REQUEST_BYTES) {
      return Promise.reject(new EmbeddingUpstreamError(400));
    }
    if (this.pending.length >= 32) return Promise.reject(new EmbeddingUpstreamError(429));
    return new Promise((resolve, reject) => {
      const item = { priority: background ? 0 : 1, start: async () => {
        signal?.removeEventListener('abort', abort);
        try {
          const deadline = AbortSignal.timeout(background ? 30_000 : 20_000);
          onProgress?.('running');
          resolve(await this.send(endpoint, input.length, body, signal ? AbortSignal.any([deadline, signal]) : deadline));
        }
        catch (error) { reject(error); }
      } };
      const abort = () => {
        const position = this.pending.indexOf(item);
        if (position >= 0) this.pending.splice(position, 1);
        reject(signal?.reason);
      };
      if (signal?.aborted) { abort(); return; }
      if (this.running) onProgress?.('queued');
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.push(item);
      this.pump();
    });
  }

  private pump(): void {
    if (this.running || !this.pending.length) return;
    const foreground = this.pending.findIndex(({ priority }) => priority === 1);
    const [item] = this.pending.splice(Math.max(0, foreground), 1);
    this.running = true;
    void item.start().finally(() => { this.running = false; this.pump(); });
  }

  private async send(endpoint: EmbeddingEndpoint, count: number, body: string, signal: AbortSignal): Promise<number[][]> {
    signal.throwIfAborted();
    const url = new URL(endpoint.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new EmbeddingUpstreamError(400);
    const pathname = url.pathname.replace(/\/+$/, '');
    url.pathname = pathname.endsWith('/embeddings') ? pathname : `${pathname || '/v1'}/embeddings`;
    const headers = new Headers(endpoint.headers);
    headers.set('Content-Type', 'application/json');
    const response = await this.request(url, { method: 'POST', headers, body, signal });
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      const after = response.headers.get('retry-after');
      const retryAt = after ? (/^\d+$/.test(after) ? Date.now() + 1000 * Number(after) : Date.parse(after)) : undefined;
      throw new EmbeddingUpstreamError(response.status, retryAt);
    }
    const buffers: Uint8Array[] = [];
    let size = 0;
    try {
      for await (const bytes of response.body) {
        size += bytes.byteLength;
        if (size > RESPONSE_BYTES) throw new EmbeddingUpstreamError(502);
        buffers.push(bytes);
      }
      return parseVectors(JSON.parse(Buffer.concat(buffers, size).toString('utf8')), count, endpoint.model.dimensions, endpoint.model.indexDimensions);
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof EmbeddingUpstreamError) throw error;
      throw new EmbeddingUpstreamError(502);
    }
  }
}
