import { defineTask } from '../tasks/taskProtocol.js';

export const CHUNK_VERSION = 1;
export const SOURCE_WINDOW = 513;
export interface ChunkInput { text: string; offset: number; prefixBytes: number; maxInputTokens: number }
export interface Chunk { contents: string; start: number; end: number; next: number; finished: boolean }

// UTF-8 bytes give a conservative input budget for byte-fallback tokenizers.
// Keep eight tokens for provider framing. Split on Unicode scalar boundaries.
export function splitEmbeddingChunk({ text, offset, prefixBytes, maxInputTokens }: ChunkInput): Chunk {
  const budget = Math.min(512, maxInputTokens) - prefixBytes - 8;
  if (budget < 4) throw new Error('Document prefix exceeds the input budget');
  const points = Array.from(text);
  let bytes = 0;
  let end = 0;
  let boundary = 0;
  while (end < points.length) {
    const point = points[end];
    const length = Buffer.byteLength(point);
    if (bytes + length > budget) break;
    bytes += length;
    end += 1;
    if (bytes >= budget / 2 && /[\n.!?。！？\s]/u.test(point)) boundary = end;
  }
  const finished = end === points.length && end < SOURCE_WINDOW;
  if (!finished && boundary) end = boundary;
  let next = end;
  if (!finished) {
    const overlap = Math.min(64, Math.floor(budget / 8));
    let size = 0;
    while (next > Math.max(1, end / 2) && size + Buffer.byteLength(points[next - 1]) <= overlap) {
      size += Buffer.byteLength(points[--next]);
    }
  }
  return { contents: points.slice(0, end).join(''), start: offset, end: offset + end, next: offset + next, finished };
}

export interface ChunkBatch { inputs: ChunkInput[]; width: number }
export interface PlannedChunk { job: number; chunk: Chunk }

export default defineTask<ChunkBatch, PlannedChunk[]>({ run({ inputs, width }) {
  const result: PlannedChunk[] = [];
  const configured = inputs.map((input) => ({ input, points: Array.from(input.text), position: 0 }));
  for (const [job, state] of configured.entries()) {
    while (result.length < width) {
      const { input, points, position } = state;
      const chunk = splitEmbeddingChunk({ ...input, offset: input.offset + position,
        text: points.slice(position, position + SOURCE_WINDOW).join('') });
      result.push({ job, chunk });
      if (chunk.finished || job !== 0) break;
      state.position = chunk.next - input.offset;
      // A full SQL window may end before the end of the source. Continue next slice.
      if (points.length - state.position < SOURCE_WINDOW && points.length >= width * SOURCE_WINDOW) break;
    }
  }
  return result;
} });
