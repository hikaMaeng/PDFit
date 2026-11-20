import type { BookOutlineEntry } from '../../common/protocol/outlines/index.js';
import type { PdfOutlineResult } from './pdfOutline.js';

export interface PdfOutlineStorage {
  /** Null means missing, an empty array means deleted, undefined means unsupported. */
  load(): Promise<BookOutlineEntry[] | null | undefined>;
  initialize(entries: BookOutlineEntry[]): Promise<'saved' | 'exists' | 'failed'>;
  save(entries: BookOutlineEntry[]): Promise<boolean>;
  remove(): Promise<boolean>;
}

export type OutlineReader = () => Promise<PdfOutlineResult>;
export type ViewerOutlineResult = PdfOutlineResult | { status: 'deleted' };

function storedOutline(entries: BookOutlineEntry[]): ViewerOutlineResult {
  return entries.length ? { status: 'ok', entries, source: 'stored' } : { status: 'deleted' };
}

export function tryReadPdfOutline(read: OutlineReader): Promise<PdfOutlineResult> {
  return Promise.resolve().then(read).catch(() => ({ status: 'failed', reason: 'error' }));
}

export async function loadOutlineWithStorage(readFromPdf: OutlineReader, storage?: PdfOutlineStorage | null):
Promise<{ result: ViewerOutlineResult; canSave: boolean }> {
  const stored = await storage?.load().catch(() => undefined);
  if (stored) return { result: storedOutline(stored), canSave: true };

  const result = await tryReadPdfOutline(readFromPdf);
  const canSave = stored === null;
  if (result.status !== 'ok') return { result, canSave };
  const initialized = canSave ? await storage?.initialize(result.entries).catch(() => 'failed') : undefined;
  if (initialized === 'exists') {
    const current = await storage?.load().catch(() => undefined);
    if (current) return { result: storedOutline(current), canSave };
  }
  return { result: { ...result, source: 'pdf', saved: initialized === 'saved' }, canSave };
}
