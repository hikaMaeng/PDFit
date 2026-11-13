import type { BookOutlineEntry } from '../../common/protocol/outlines/index.js';
import type { PdfOutlineResult } from './pdfOutline.js';

/** Where a book's successfully read outline is kept (the server database through `/api/outlines`). */
export interface PdfOutlineStorage {
  /** The stored outline, or null when there is none to use. Must not throw. */
  load(): Promise<BookOutlineEntry[] | null>;
  /** Stores a successfully read outline. Resolves false when it was not stored. Must not throw. */
  save(entries: BookOutlineEntry[]): Promise<boolean>;
}

/**
 * Answers the table of contents from storage when an outline is stored there. Otherwise reads it
 * from the PDF, and stores the result only when the read succeeded. A failed lookup is never
 * stored, so the next open tries the PDF again.
 */
export async function loadOutlineWithStorage(readFromPdf: () => Promise<PdfOutlineResult>, storage?: PdfOutlineStorage | null): Promise<PdfOutlineResult> {
  const stored = storage ? await storage.load().catch(() => null) : null;
  if (stored && stored.length > 0) return { status: 'ok', entries: stored, source: 'stored' };
  const result = await readFromPdf();
  if (result.status !== 'ok') return result;
  const saved = storage ? await storage.save(result.entries).catch(() => false) : false;
  return { ...result, source: 'pdf', saved };
}
