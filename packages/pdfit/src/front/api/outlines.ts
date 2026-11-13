import type { BookOutlineEntry, BookOutlinePayload } from '../../common/protocol/outlines/index.js';
import { parseBookOutlineEntries } from '../../common/protocol/outlines/index.js';

const outlineUrl = (folder: string, filename: string, driveFileId?: string | null) => {
  const path = `/api/outlines/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`;
  return driveFileId ? `${path}?driveFileId=${encodeURIComponent(driveFileId)}` : path;
};

/** Stored table of contents of one book (`/api/outlines`). */
export const outlinesApi = {
  /** The stored outline, or null when none is stored, the server does not store outlines (501), or the request failed. */
  async getStored(folder: string, filename: string, driveFileId?: string | null): Promise<BookOutlineEntry[] | null> {
    try {
      const response = await fetch(outlineUrl(folder, filename, driveFileId), { cache: 'no-store' });
      if (!response.ok) return null;
      const body = await response.json() as Partial<BookOutlinePayload>;
      return parseBookOutlineEntries(body.entries);
    } catch {
      return null;
    }
  },

  /** Stores a successfully read outline. Resolves false when the server did not store it. */
  async save(folder: string, filename: string, entries: BookOutlineEntry[], driveFileId?: string | null): Promise<boolean> {
    try {
      const response = await fetch(outlineUrl(folder, filename, driveFileId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries } satisfies BookOutlinePayload),
      });
      return response.ok;
    } catch {
      return false;
    }
  },
};
