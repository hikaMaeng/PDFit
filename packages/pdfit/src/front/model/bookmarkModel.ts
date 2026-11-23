import type { BookmarkRecord } from '../../common/protocol/bookmarks/index.js';

export class BookmarkModel {
  private readonly listeners = new Set<() => void>();
  private bookmarks: BookmarkRecord[] = [];
  private version = 0;
  private refreshChanges: Map<string, BookmarkRecord | null> | null = null;
  getSnapshot = () => this.version;
  getAll = () => this.bookmarks;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  replace(bookmarks: BookmarkRecord[]) { this.bookmarks = bookmarks; this.version += 1; this.listeners.forEach((listener) => listener()); }
  upsert(bookmark: BookmarkRecord) {
    this.refreshChanges?.set(bookmark.id, bookmark);
    if (!this.bookmarks.includes(bookmark)) this.replace([...this.bookmarks.filter((item) => item.id !== bookmark.id), bookmark]);
  }
  remove(id: string) {
    this.refreshChanges?.set(id, null);
    const remaining = this.bookmarks.filter((item) => item.id !== id);
    if (remaining.length !== this.bookmarks.length) this.replace(remaining);
  }

  // Keep edits and deletions received while a list request was in flight.
  async refresh(read: () => Promise<BookmarkRecord[]>) {
    const changes = new Map<string, BookmarkRecord | null>();
    this.refreshChanges = changes;
    try {
      const records = await read();
      if (this.refreshChanges !== changes) return;
      const current = new Map(records.map((record) => [record.id, record]));
      for (const [id, record] of changes) {
        if (record) current.set(id, record);
        else current.delete(id);
      }
      this.replace([...current.values()]);
    } finally {
      if (this.refreshChanges === changes) this.refreshChanges = null;
    }
  }
}

export const bookmarkLibraryModel = new BookmarkModel();
