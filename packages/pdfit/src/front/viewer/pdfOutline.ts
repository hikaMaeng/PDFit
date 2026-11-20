/**
 * Reads a PDF's table of contents (the document outline, `/Outlines` in the PDF catalog)
 * through PDF.js and flattens it into rows the viewer's table-of-contents dialog can list.
 *
 * Uses the PDF's own outline when it names navigable sections. If the catalog has no usable
 * outline, the optional bookstore lookup supplies the titles and local PDF text locates them.
 */

import {
  BOOK_OUTLINE_MAX_DEPTH,
  BOOK_OUTLINE_MAX_ENTRIES,
  BOOK_OUTLINE_MAX_TITLE_LENGTH,
  type BookOutlineEntry,
} from '../../common/protocol/outlines/index.js';
import { readBookstoreOutline, type BookstoreOutlineLookup, type OutlinePageSource } from './bookstoreOutline.js';

/** Explicit PDF destination: `[pageRef | pageIndex, /XYZ | /Fit ..., ...]`. */
type ExplicitDestination = readonly unknown[];

/** One node of PDF.js `PDFDocumentProxy.getOutline()`. Only the fields used here. */
export interface PdfOutlineNode {
  title: string;
  dest: string | ExplicitDestination | null;
  url?: string | null;
  items: PdfOutlineNode[];
}

/** The subset of `PDFDocumentProxy` the resolver needs, so tests can pass a plain object. */
export interface PdfOutlineSource extends Partial<OutlinePageSource> {
  numPages: number;
  getOutline(): Promise<PdfOutlineNode[] | null>;
  getDestination(id: string): Promise<ExplicitDestination | null>;
  getPageIndex(ref: { num: number; gen: number }): Promise<number>;
}

/** A flattened outline row: the same shape the server stores (`BookOutlineEntry`). */
export type PdfOutlineEntry = BookOutlineEntry;

export type PdfOutlineFailureReason = 'empty' | 'error';

export type PdfOutlineResult =
  | {
    status: 'ok';
    entries: PdfOutlineEntry[];
    /** Where the entries came from: the stored copy, or a fresh read of the PDF. Absent from `readPdfOutline`. */
    source?: 'stored' | 'pdf' | 'yes24';
    /** After a fresh read: whether the server stored it. */
    saved?: boolean;
  }
  | { status: 'failed'; reason: PdfOutlineFailureReason };

/** Upper bound on listed entries, so a malformed or cyclic outline cannot freeze the dialog. Equals the stored limit. */
export const MAX_OUTLINE_ENTRIES = BOOK_OUTLINE_MAX_ENTRIES;
/** Upper bound on nesting depth for the same reason. Equals the stored limit. */
export const MAX_OUTLINE_DEPTH = BOOK_OUTLINE_MAX_DEPTH;

function isPageRef(value: unknown): value is { num: number; gen: number } {
  return typeof value === 'object' && value !== null
    && Number.isInteger((value as { num?: unknown }).num)
    && Number.isInteger((value as { gen?: unknown }).gen);
}

/** Resolves one outline destination to a 1-based page number, or null when it names no page of this PDF. */
export async function resolveOutlineDestinationPage(source: PdfOutlineSource, dest: PdfOutlineNode['dest']): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await source.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || explicit.length === 0) return null;
    const target = explicit[0];
    let index: number | null = null;
    if (isPageRef(target)) index = await source.getPageIndex(target);
    // Some writers store a 0-based page index instead of a page reference.
    else if (Number.isInteger(target)) index = target as number;
    if (index === null || index < 0 || index >= source.numPages) return null;
    return index + 1;
  } catch {
    return null;
  }
}

/**
 * Reads and flattens the outline in document order. Entries whose destination cannot be
 * resolved are still listed with `page: null`. An outline that is missing, empty, or throws
 * while being read is `failed`.
 */
async function readEmbeddedOutline(source: PdfOutlineSource): Promise<PdfOutlineResult> {
  let roots: PdfOutlineNode[] | null;
  try {
    roots = await source.getOutline();
  } catch {
    return { status: 'failed', reason: 'error' };
  }
  if (!Array.isArray(roots) || roots.length === 0) return { status: 'failed', reason: 'empty' };

  const pending: Array<{ node: PdfOutlineNode; depth: number; key: string }> = [];
  const visit = (nodes: PdfOutlineNode[], depth: number, prefix: string) => {
    nodes.forEach((node, index) => {
      if (pending.length >= MAX_OUTLINE_ENTRIES) return;
      const key = prefix ? `${prefix}.${index}` : String(index);
      pending.push({ node, depth, key });
      if (depth + 1 < MAX_OUTLINE_DEPTH && Array.isArray(node.items) && node.items.length > 0) visit(node.items, depth + 1, key);
    });
  };
  visit(roots, 0, '');

  const pages = await Promise.all(pending.map(({ node }) => resolveOutlineDestinationPage(source, node.dest)));
  const entries = pending.map(({ node, depth, key }, index) => ({
    key,
    title: (typeof node.title === 'string' ? node.title : '').replace(/\s+/g, ' ').trim().slice(0, BOOK_OUTLINE_MAX_TITLE_LENGTH),
    depth,
    page: pages[index] ?? null,
  }));
  return { status: 'ok', entries };
}

export async function readPdfOutline(source: PdfOutlineSource, lookup?: BookstoreOutlineLookup): Promise<PdfOutlineResult> {
  let embedded = await readEmbeddedOutline(source);
  if (embedded.status === 'ok') {
    const named = embedded.entries.filter(({ title }) => /\p{L}/u.test(title) && !/^[ivx]+$/i.test(title));
    if (named.some(({ page }) => page !== null)) return embedded;
    if (!named.length) embedded = { status: 'failed', reason: 'empty' };
  }
  if (!lookup || !source.getPage || !source.getPageLabels) return embedded;
  const entries = await readBookstoreOutline(source as OutlinePageSource, lookup);
  return entries ? { status: 'ok', entries, source: 'yes24' } : embedded;
}
