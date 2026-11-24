import {
  BOOK_COMMENTS_PATH, parseBookComment, parseBookCommentPage,
  type BookCommentPage, type CommentBook,
} from '../../../common/protocol/book-comments/index.js';
import { createBrowserUuid } from '../../browserUuid.js';

type Mode = 'read' | 'create' | 'edit' | 'delete';

class BookCommentsModel {
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private book: CommentBook | null = null;
  private readRequest: AbortController | null = null;
  private draftId = '';
  private requestedPage = 1;

  page: BookCommentPage | null = null;
  mode: Mode = 'read';
  loading = false;
  saving = false;
  error: 'load' | 'save' | null = null;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getVersion = () => this.version;

  private emit() {
    this.version += 1;
    this.listeners.forEach((listener) => listener());
  }

  open(book: CommentBook) {
    this.book = book;
    this.page = null;
    this.mode = 'read';
    this.saving = false;
    void this.load(1);
  }

  close() {
    this.readRequest?.abort();
    this.book = null;
    this.page = null;
  }

  private url(book: CommentBook) {
    const query = new URLSearchParams({ folder: book.folder, filename: book.filename });
    if (book.driveFileId) query.set('driveFileId', book.driveFileId);
    return `${BOOK_COMMENTS_PATH}?${query}`;
  }

  async load(page: number) {
    if (!this.book) return;
    this.requestedPage = page;
    this.readRequest?.abort();
    const request = new AbortController();
    this.readRequest = request;
    this.loading = true;
    this.error = null;
    this.emit();
    try {
      const response = await fetch(`${this.url(this.book)}&page=${page}`, { signal: request.signal });
      const result = response.ok ? parseBookCommentPage(await response.json()) : null;
      if (!result) throw new Error('Unable to load book comments.');
      if (!request.signal.aborted) this.page = result;
    } catch {
      if (!request.signal.aborted) this.error = 'load';
    } finally {
      if (!request.signal.aborted) {
        this.loading = false;
        this.emit();
      }
    }
  }

  retry = () => void this.load(this.requestedPage);

  setMode(mode: Mode) {
    this.mode = mode;
    this.error = null;
    if (mode === 'create') this.draftId = createBrowserUuid();
    this.emit();
  }

  async save(body?: string) {
    const book = this.book;
    const mode = this.mode;
    if (!book || mode === 'read' || this.saving) return;
    const id = mode === 'create' ? this.draftId : this.page?.comment?.id;
    if (!id || (mode !== 'delete' && !body?.trim())) return;
    this.saving = true;
    this.error = null;
    this.emit();
    try {
      const response = await fetch(`${this.url(book)}&id=${encodeURIComponent(id)}`, mode === 'delete'
        ? { method: 'DELETE' }
        : { method: mode === 'create' ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) });
      if (!response.ok || (mode !== 'delete' && !parseBookComment(await response.json()))) throw new Error('Unable to save book comment.');
      if (this.book !== book) return;
      this.mode = 'read';
      this.page = null;
      void this.load(mode === 'create' ? 1 : this.requestedPage);
    } catch {
      if (this.book === book) this.error = 'save';
    } finally {
      if (this.book === book) {
        this.saving = false;
        this.emit();
      }
    }
  }
}

export const bookCommentsModel = new BookCommentsModel();
