import { loadPdfJs } from '../pdfjs.js';
import { readPdfOutline, type PdfOutlineResult, type PdfOutlineSource } from './pdfOutline.js';
import type { BookstoreOutlineLookup } from './bookstoreOutline.js';

const OUTLINE_RANGE_CHUNK_SIZE = 256 * 1024;

/**
 * Reads the outline of the PDF at `url` with PDF.js range requests, for a viewer engine that
 * does not hold a PDF.js document (PDFGPU). Page text is fetched only when aligning a YES24 outline.
 * The temporary document is destroyed before returning.
 */
export async function readPdfOutlineFromUrl(url: string, lookup?: BookstoreOutlineLookup): Promise<PdfOutlineResult> {
  let task: { promise: Promise<unknown>; destroy(): Promise<void> } | null = null;
  try {
    const pdfjsLib = await loadPdfJs();
    task = pdfjsLib.getDocument({ url, rangeChunkSize: OUTLINE_RANGE_CHUNK_SIZE, disableAutoFetch: true, disableStream: true });
    const doc = await task.promise as PdfOutlineSource;
    return await readPdfOutline(doc, lookup);
  } catch {
    return { status: 'failed', reason: 'error' };
  } finally {
    await task?.destroy().catch(() => {});
  }
}
