import type { BookmarkRecord } from '../../common/protocol/bookmarks/index.js';

export class BookmarkModel {
  private readonly listeners = new Set<() => void>();
  private bookmarks: BookmarkRecord[] = [];
  private version = 0;
  getSnapshot = () => this.version;
  getAll = () => this.bookmarks;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  replace(bookmarks: BookmarkRecord[]) { this.bookmarks = bookmarks; this.version += 1; this.listeners.forEach((listener) => listener()); }
  upsert(bookmark: BookmarkRecord) { this.replace([...this.bookmarks.filter((item) => item.id !== bookmark.id), bookmark]); }
  remove(id: string) { this.replace(this.bookmarks.filter((item) => item.id !== id)); }
}

export const bookmarkLibraryModel = new BookmarkModel();
