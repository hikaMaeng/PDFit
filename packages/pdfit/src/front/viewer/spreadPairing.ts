import { normalizeViewerPage, type PdfGpuSpreadPairing } from '@pdfgpu/core';

/**
 * Two-page (spread) pairing, chosen by the reader at runtime in both viewers.
 *
 * - `paired`: (1,2), (3,4), ... — the first page shares a row with page 2.
 * - `alone`:  (1), (2,3), (4,5), ... — the cover stands alone.
 *
 * Pages are 1-based and a row is identified by its lead (left-most) page. Row rules come
 * from `@pdfgpu/core` (>= 0.1.11 `normalizeViewerPage(page, count, 'double', pairing)`),
 * so the PDF.js viewer, the GPU viewer and the shared key/wheel reducer agree.
 */
export type SpreadCover = PdfGpuSpreadPairing;

export const DEFAULT_SPREAD_COVER: SpreadCover = 'paired';

/** Lead page of the row that contains `page`, clamped to `[1, pageCount]`. */
export function spreadLeadPage(page: number, pageCount: number, cover: SpreadCover): number {
  return normalizeViewerPage(page, pageCount, 'double', cover);
}

/** Pages shown in the row that contains `page` (1 or 2 pages). */
export function spreadRowPages(page: number, pageCount: number, cover: SpreadCover): number[] {
  if (pageCount <= 0) return [];
  const lead = spreadLeadPage(page, pageCount, cover);
  if (cover === 'alone' && lead === 1) return [1];
  return lead + 1 <= pageCount ? [lead, lead + 1] : [lead];
}

/** Lead page of the last row. */
export function lastSpreadLead(pageCount: number, cover: SpreadCover): number {
  return spreadLeadPage(pageCount, pageCount, cover);
}

/**
 * Switching the pairing lands on the new row that contains the current page, which can
 * move the view forward a row ((2,3) -> paired (1,2) -> alone (1)). To make a switch
 * followed directly by the opposite switch return to where the reader was, the viewer
 * keeps the page it switched from and the lead it landed on.
 *
 * Scope: one viewer instance (one open document). Lifetime: until the reader navigates
 * (the current page no longer equals `landed`) or the viewer unmounts. Bound: one entry.
 */
export type SpreadToggleMemory = { from: number; landed: number } | null;

/** Page whose row the next pairing switch should land on. */
export function spreadToggleTarget(memory: SpreadToggleMemory, currentPage: number): number {
  return memory && memory.landed === currentPage ? memory.from : currentPage;
}

/** Memory after switching to `cover` from `currentPage`. */
export function nextSpreadToggleMemory(
  memory: SpreadToggleMemory,
  currentPage: number,
  pageCount: number,
  cover: SpreadCover,
): SpreadToggleMemory {
  const from = spreadToggleTarget(memory, currentPage);
  return { from, landed: spreadLeadPage(from, pageCount, cover) };
}

const STORAGE_KEY = 'pdfit.viewer.spreadCover';

/**
 * Per-browser reader preference. Key `pdfit.viewer.spreadCover` in `localStorage`,
 * shared by both viewers and every document of this origin, lifetime until the reader
 * clears site data. Storage failures (private mode, blocked storage) fall back to the default.
 */
export function readSpreadCoverPreference(): SpreadCover {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    return value === 'alone' || value === 'paired' ? value : DEFAULT_SPREAD_COVER;
  } catch {
    return DEFAULT_SPREAD_COVER;
  }
}

export function writeSpreadCoverPreference(cover: SpreadCover): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, cover);
  } catch {
    // Preference only; the current session keeps the in-memory value.
  }
}
