/**
 * Two-page (spread) pairing for the PDF.js viewer, chosen by the reader at runtime.
 *
 * - `paired`: (1,2), (3,4), ... — the first page shares a row with page 2.
 * - `alone`:  (1), (2,3), (4,5), ... — the cover stands alone, as printed books and
 *   the `@pdfgpu/core` layout do.
 *
 * Pages are 1-based. A row is identified by its lead (left-most) page.
 * `@pdfgpu/core`'s `normalizeViewerPage` hard-codes the `alone` rule since 0.1.10,
 * so the PDF.js viewer must not use it to pick spread rows.
 */
export type SpreadCover = 'paired' | 'alone';

export const DEFAULT_SPREAD_COVER: SpreadCover = 'paired';

/** Lead page of the row that contains `page`, clamped to `[1, pageCount]`. */
export function spreadLeadPage(page: number, pageCount: number, cover: SpreadCover): number {
  const count = Math.max(0, Math.floor(pageCount));
  if (count === 0) return 1;
  const clamped = Math.max(1, Math.min(count, Math.floor(Number.isFinite(page) ? page : 1)));
  if (cover === 'alone') {
    if (clamped <= 1) return 1;
    return clamped % 2 === 0 ? clamped : clamped - 1;
  }
  return clamped % 2 === 1 ? clamped : clamped - 1;
}

/** Pages shown in the row led by `lead` (1 or 2 pages). */
export function spreadRowPages(lead: number, pageCount: number, cover: SpreadCover): number[] {
  const first = spreadLeadPage(lead, pageCount, cover);
  if (pageCount <= 0) return [];
  if (cover === 'alone' && first === 1) return [1];
  return first + 1 <= pageCount ? [first, first + 1] : [first];
}

/** Lead page of the row `direction` rows away from the row containing `page`. */
export function stepSpreadRow(page: number, pageCount: number, cover: SpreadCover, direction: 1 | -1): number {
  const lead = spreadLeadPage(page, pageCount, cover);
  if (direction > 0) {
    const rowEnd = lead + spreadRowPages(lead, pageCount, cover).length - 1;
    return spreadLeadPage(rowEnd + 1, pageCount, cover);
  }
  return spreadLeadPage(lead - 1, pageCount, cover);
}

/** Lead page of the last row. */
export function lastSpreadLead(pageCount: number, cover: SpreadCover): number {
  return spreadLeadPage(pageCount, pageCount, cover);
}

const STORAGE_KEY = 'pdfit.viewer.spreadCover';

/**
 * Per-browser reader preference. Key `pdfit.viewer.spreadCover` in `localStorage`,
 * shared by every document of this origin, lifetime until the reader clears site data.
 * Storage failures (private mode, blocked storage) fall back to the default.
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
