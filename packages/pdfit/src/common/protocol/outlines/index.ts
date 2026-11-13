/**
 * Table-of-contents wire contract shared by the viewer and `/api/outlines`.
 *
 * A stored outline is one the viewer read successfully from the PDF's own `/Outlines`.
 * Failed lookups (no outline, unreadable outline) are never stored.
 */

/** One flattened outline row. `page` is 1-based, or null when the entry names no page of the PDF. */
export interface BookOutlineEntry {
  /** Position path within the outline, such as `0.2.1`. Unique within one outline. */
  key: string;
  title: string;
  /** 0 for a top-level entry. */
  depth: number;
  page: number | null;
}

/** `GET /api/outlines/:folder/:filename` answer, and the `PUT` body. */
export interface BookOutlinePayload {
  entries: BookOutlineEntry[];
}

/** Upper bound on stored entries; the viewer stops reading at the same count. */
export const BOOK_OUTLINE_MAX_ENTRIES = 5000;
/** Upper bound on nesting depth; the viewer stops descending at the same depth. */
export const BOOK_OUTLINE_MAX_DEPTH = 32;
/** Upper bound on one entry title, in UTF-16 code units. */
export const BOOK_OUTLINE_MAX_TITLE_LENGTH = 1000;

const KEY_PATTERN = /^\d+(?:\.\d+)*$/;

/** Validates a stored or submitted outline. Returns the entries, or null when it is empty or any row is invalid. */
export function parseBookOutlineEntries(value: unknown): BookOutlineEntry[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > BOOK_OUTLINE_MAX_ENTRIES) return null;
  const keys = new Set<string>();
  const entries: BookOutlineEntry[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object') return null;
    const { key, title, depth, page } = row as Record<string, unknown>;
    if (typeof key !== 'string' || key.length > 200 || !KEY_PATTERN.test(key) || keys.has(key)) return null;
    if (typeof title !== 'string' || title.length > BOOK_OUTLINE_MAX_TITLE_LENGTH) return null;
    if (typeof depth !== 'number' || !Number.isInteger(depth) || depth < 0 || depth >= BOOK_OUTLINE_MAX_DEPTH) return null;
    if (page !== null && (typeof page !== 'number' || !Number.isInteger(page) || page < 1)) return null;
    keys.add(key);
    entries.push({ key, title, depth, page });
  }
  return entries;
}
