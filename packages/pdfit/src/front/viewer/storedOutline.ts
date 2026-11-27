import type { BookOutlineEntry } from '../../common/protocol/outlines/index.js';
import type { PdfOutlineResult } from './pdfOutline.js';

export interface PdfOutlineStorage {
  /** Null means missing, an empty array means deleted, undefined means unsupported. */
  load(): Promise<BookOutlineEntry[] | null | undefined>;
  initialize(entries: BookOutlineEntry[]): Promise<'saved' | 'exists' | 'failed'>;
  save(entries: BookOutlineEntry[], generated?: boolean): Promise<boolean>;
  remove(): Promise<boolean>;
}

export type OutlineReader = (signal: AbortSignal) => Promise<PdfOutlineResult>;
export type ViewerOutlineResult = PdfOutlineResult | { status: 'deleted' };

const OUTLINE_READ_TIMEOUT_MS = 30_000;

function storedOutline(entries: BookOutlineEntry[]): ViewerOutlineResult {
  return entries.length ? { status: 'ok', entries, source: 'stored' } : { status: 'deleted' };
}

export async function tryReadPdfOutline(read: OutlineReader): Promise<PdfOutlineResult> {
  const controller = new AbortController();
  const { signal } = controller;
  const timer = setTimeout(() => controller.abort(), OUTLINE_READ_TIMEOUT_MS);
  const aborted = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  try {
    return await Promise.race([read(signal), aborted]);
  } catch {
    return { status: 'failed', reason: 'error' };
  } finally {
    clearTimeout(timer);
  }
}

export function hasOutlineDestination(entries: BookOutlineEntry[]): boolean {
  return entries.some(({ page }) => page !== null);
}

export async function loadOutlineWithStorage(readFromPdf: OutlineReader, storage?: PdfOutlineStorage | null):
Promise<{ result: ViewerOutlineResult; canSave: boolean }> {
  const stored = await storage?.load().catch(() => 'failed' as const);
  if (Array.isArray(stored)) return { result: storedOutline(stored), canSave: true };

  const result = await tryReadPdfOutline(readFromPdf);
  const canSave = stored === null;
  if (result.status !== 'ok') return { result: stored === 'failed' ? { status: 'failed', reason: 'error' } : result, canSave };
  const initialized = canSave && hasOutlineDestination(result.entries)
    ? await storage?.initialize(result.entries).catch(() => 'failed') : undefined;
  if (initialized === 'exists') {
    const current = await storage?.load().catch(() => undefined);
    if (current) return { result: storedOutline(current), canSave };
  }
  return { result: { ...result, source: result.source ?? 'pdf', saved: initialized === 'saved' }, canSave };
}
