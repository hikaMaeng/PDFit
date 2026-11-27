import {
  BOOK_COMMENT_IMAGE_BYTES, BOOK_COMMENT_IMAGE_LIMIT, BOOK_COMMENT_IMAGE_NAME_LIMIT,
  bookCommentUrl, isBookCommentImageType, parseBookComment, parseBookCommentPage, parseBookCommentReferencePages,
  type BookCommentImage, type BookCommentPage, type CommentBook,
} from '../../../common/protocol/book-comments/index.js';
import { createBrowserUuid } from '../../browserUuid.js';
import { publishBookCommentChange } from './countModel.js';

type Mode = 'read' | 'create' | 'edit' | 'delete';
type ListFilter = 'latest' | 'current';
type DraftImage = BookCommentImage & { file?: File };

function parseReferencePageInput(value: string) {
  const tokens = value.split(/[,，、،\s]+/).filter(Boolean);
  if (tokens.some((token) => !/^\d+$/.test(token))) return null;
  return parseBookCommentReferencePages(tokens.map(Number));
}

async function encodeImage({ id, name, file }: DraftImage) {
  if (!file) return { id };
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  return { id, name, mimeType: file.type, base64 };
}

class BookCommentsModel {
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private book: CommentBook | null = null;
  private readRequest: AbortController | null = null;
  private draftId = '';
  private requestedPage = 1;
  private viewerPage: number | undefined;
  private refreshOnRead = false;

  page: BookCommentPage | null = null;
  filter: ListFilter = 'latest';
  mode: Mode = 'read';
  selectedId: string | null = null;
  loading = false;
  saving = false;
  error: 'load' | 'save' | null = null;
  draftImages: DraftImage[] = [];
  draftReferencePages = '';
  imageError = false;
  referencePagesError = false;

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
    this.viewerPage = undefined;
    this.filter = 'latest';
    this.refreshOnRead = false;
    this.mode = 'read';
    this.selectedId = null;
    this.saving = false;
    this.draftImages = [];
    this.imageError = false;
    this.referencePagesError = false;
    void this.load(1);
  }

  close() {
    this.readRequest?.abort();
    this.book = null;
    this.page = null;
    this.draftImages = [];
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
      const query = new URLSearchParams({ page: String(page) });
      if (this.filter === 'current' && this.viewerPage !== undefined) query.set('referencePage', String(this.viewerPage));
      const response = await fetch(`${bookCommentUrl(this.book)}&${query}`, { signal: request.signal });
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

  setViewerPage(page: number) {
    if (!this.book || page === this.viewerPage) return;
    this.viewerPage = page;
    if (this.filter !== 'current') return;
    this.requestedPage = 1;
    if (this.mode === 'read') {
      this.page = null;
      void this.load(1);
    } else {
      this.refreshOnRead = true;
    }
  }

  setFilter(filter: ListFilter) {
    if (filter === this.filter || this.mode !== 'read') return;
    this.filter = filter;
    this.page = null;
    void this.load(1);
  }

  setMode(mode: Mode, commentId: string | null = null) {
    this.mode = mode;
    this.selectedId = commentId;
    this.error = null;
    this.imageError = false;
    this.referencePagesError = false;
    const comment = mode === 'edit' ? this.page?.comments.find(({ id }) => id === commentId) : undefined;
    this.draftImages = comment?.images?.slice() ?? [];
    this.draftReferencePages = comment?.referencePages?.join(', ') ?? String(this.viewerPage ?? '');
    if (mode === 'create') this.draftId = createBrowserUuid();
    if (mode === 'read' && this.refreshOnRead) {
      this.refreshOnRead = false;
      this.page = null;
      void this.load(1);
    } else {
      this.emit();
    }
  }

  addImages(files: File[]) {
    if (this.saving || (this.mode !== 'create' && this.mode !== 'edit')) return;
    this.imageError = false;
    for (const file of files) {
      const name = file.name.trim().slice(0, BOOK_COMMENT_IMAGE_NAME_LIMIT);
      if (!name || !file.size || file.size > BOOK_COMMENT_IMAGE_BYTES || !isBookCommentImageType(file.type) ||
        this.draftImages.length >= BOOK_COMMENT_IMAGE_LIMIT) {
        this.imageError = true;
        continue;
      }
      this.draftImages.push({ id: createBrowserUuid(), name, file });
    }
    this.emit();
  }

  removeImage(id: string) {
    if (this.saving) return;
    this.draftImages = this.draftImages.filter((image) => image.id !== id);
    this.imageError = false;
    this.emit();
  }

  clearReferencePagesError = () => {
    if (!this.referencePagesError) return;
    this.referencePagesError = false;
    this.emit();
  };

  async save(body?: string, pageInput = '') {
    const book = this.book;
    const mode = this.mode;
    if (!book || mode === 'read' || this.saving) return;
    const id = mode === 'create' ? this.draftId : this.selectedId;
    if (!id || (mode !== 'delete' && !body?.trim() && !this.draftImages.length)) return;
    const referencePages = mode === 'delete' ? undefined : parseReferencePageInput(pageInput);
    this.referencePagesError = referencePages === null;
    if (this.referencePagesError) {
      this.emit();
      return;
    }
    this.saving = true;
    this.error = null;
    this.emit();
    try {
      const images = mode === 'delete' ? undefined : await Promise.all(this.draftImages.map(encodeImage));
      const response = await fetch(`${bookCommentUrl(book)}&id=${encodeURIComponent(id)}`, mode === 'delete'
        ? { method: 'DELETE' }
        : { method: mode === 'create' ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: body ?? '', images, referencePages }) });
      if (!response.ok || (mode !== 'delete' && !parseBookComment(await response.json()))) throw new Error('Unable to save book comment.');
      if (mode !== 'edit') publishBookCommentChange(book);
      if (this.book !== book) return;
      this.mode = 'read';
      this.selectedId = null;
      this.draftImages = [];
      this.imageError = false;
      this.refreshOnRead = false;
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
export const viewerBookCommentsModel = new BookCommentsModel();
