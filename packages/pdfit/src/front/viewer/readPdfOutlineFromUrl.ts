import { loadPdfJs } from '../pdfjs.js';
import { readPdfOutline, type PdfOutlineResult, type PdfOutlineSource } from './pdfOutline.js';
import type { BookstoreOutlineLookup } from './bookstoreOutline.js';

const OUTLINE_RANGE_CHUNK_SIZE = 256 * 1024;

/**
 * Reads the outline of the PDF at `url` with PDF.js range requests, for a viewer engine that
 * does not hold a PDF.js document (PDFGPU). Page text is fetched only when aligning a YES24 outline.
 * The temporary document is destroyed before returning.
 */
export async function readPdfOutlineFromUrl(url: string, lookup?: BookstoreOutlineLookup, signal?: AbortSignal): Promise<PdfOutlineResult> {
  let task: { promise: Promise<unknown>; destroy(): Promise<void> } | null = null;
  let destroyed: Promise<void> | undefined;
  const destroyTask = () => destroyed ??= task?.destroy().catch(() => {}) ?? Promise.resolve();
  try {
    const pdfjsLib = await loadPdfJs();
    signal?.throwIfAborted();
    task = pdfjsLib.getDocument({ url, rangeChunkSize: OUTLINE_RANGE_CHUNK_SIZE, disableAutoFetch: true, disableStream: true });
    signal?.addEventListener('abort', destroyTask, { once: true });
    const doc = await task.promise as PdfOutlineSource;
    return await readPdfOutline(doc, lookup, signal);
  } catch {
    return { status: 'failed', reason: 'error' };
  } finally {
    signal?.removeEventListener('abort', destroyTask);
    await destroyTask();
  }
}
