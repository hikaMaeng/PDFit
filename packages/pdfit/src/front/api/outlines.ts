import type { BookOutlineEntry, BookOutlinePayload } from '../../common/protocol/outlines/index.js';
import { parseBookOutlineEntries } from '../../common/protocol/outlines/index.js';
import type { BookstoreContents } from '../viewer/bookstoreOutline.js';

const outlineUrl = (folder: string, filename: string, driveFileId?: string | null) => {
  const path = `/api/outlines/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`;
  return driveFileId ? `${path}?driveFileId=${encodeURIComponent(driveFileId)}` : path;
};

function putOutline(url: string, entries: BookOutlineEntry[], headers: Record<string, string> = {}, generated?: boolean) {
  return fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ entries, generated } satisfies BookOutlinePayload),
  });
}

/** Stored table of contents of one book (`/api/outlines`). */
export const outlinesApi = {
  async lookupYes24(folder: string, filename: string, isbn?: string): Promise<BookstoreContents | null> {
    const url = `${outlineUrl(folder, filename)}/yes24${isbn ? `?isbn=${encodeURIComponent(isbn)}` : ''}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(25_000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`YES24 outline lookup failed (${response.status})`);
    const book = await response.json() as Partial<BookstoreContents>;
    return typeof book.title === 'string' && typeof book.contents === 'string' ? { title: book.title, contents: book.contents } : null;
  },
  /** An empty array is a deleted outline. Null means no stored copy, undefined means unsupported. */
  async getStored(folder: string, filename: string, driveFileId?: string | null): Promise<BookOutlineEntry[] | null | undefined> {
    const response = await fetch(outlineUrl(folder, filename, driveFileId), { cache: 'no-store' });
    if (response.status === 404) return null;
    if (response.status === 501) return undefined;
    if (!response.ok) throw new Error(`Outline lookup failed (${response.status})`);
    const body = await response.json() as Partial<BookOutlinePayload>;
    const entries = parseBookOutlineEntries(body.entries, { allowEmpty: true });
    if (!entries) throw new Error('Invalid stored outline');
    return entries;
  },

  async initialize(folder: string, filename: string, entries: BookOutlineEntry[], driveFileId?: string | null): Promise<'saved' | 'exists' | 'failed'> {
    const response = await putOutline(outlineUrl(folder, filename, driveFileId), entries, { 'If-None-Match': '*' });
    if (response.status === 412) return 'exists';
    return response.ok ? 'saved' : 'failed';
  },

  /** Stores a successfully read outline. Resolves false when the server did not store it. */
  async save(folder: string, filename: string, entries: BookOutlineEntry[], driveFileId?: string | null, generated?: boolean): Promise<boolean> {
    return (await putOutline(outlineUrl(folder, filename, driveFileId), entries, {}, generated)).ok;
  },

  async remove(folder: string, filename: string, driveFileId?: string | null): Promise<boolean> {
    return (await fetch(outlineUrl(folder, filename, driveFileId), { method: 'DELETE' })).ok;
  },
};
