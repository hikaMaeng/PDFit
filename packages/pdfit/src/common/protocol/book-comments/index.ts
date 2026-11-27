export interface CommentBook {
  folder: string;
  filename: string;
  driveFileId?: string;
}

export interface BookComment {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  images?: BookCommentImage[];
  referencePages?: number[];
}

export interface BookCommentImage {
  id: string;
  name: string;
}

export const BOOK_COMMENT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export type BookCommentImageType = typeof BOOK_COMMENT_IMAGE_TYPES[number];
export const BOOK_COMMENT_IMAGE_LIMIT = 4;
export const BOOK_COMMENT_IMAGE_BYTES = 3 * 1024 * 1024;
export const BOOK_COMMENT_IMAGE_NAME_LIMIT = 200;
export const BOOK_COMMENT_IMAGE_PATH = '/image';

export type BookCommentImageContent = { mimeType: BookCommentImageType; data: Uint8Array };
export type WriteBookCommentImage = { id: string } | (BookCommentImage & BookCommentImageContent);

export interface BookCommentPage {
  comments: BookComment[];
  page: number;
  total: number;
}

export const BOOK_COMMENTS_PATH = '/api/book-comments';
export const BOOK_COMMENT_COUNTS_PATH = '/counts';
export const BOOK_COMMENT_COUNTS_LIMIT = 200;
export const BOOK_COMMENT_LIMIT = 10_000;
export const BOOK_COMMENT_PAGE_SIZE = 5;
export const BOOK_COMMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface WriteBookComment {
  id: string;
  body: string;
  images?: WriteBookCommentImage[];
  referencePages?: number[];
}

export interface BookCommentStore {
  readBookComment?(book: CommentBook, id: string): Promise<BookComment | null>;
  listBookCommentCounts(books: readonly CommentBook[]): Promise<number[]>;
  listBookComments(book: CommentBook, page: number, referencePage?: number): Promise<BookCommentPage>;
  createBookComment(book: CommentBook, input: WriteBookComment): Promise<BookComment | null>;
  updateBookComment(book: CommentBook, input: WriteBookComment): Promise<BookComment | null>;
  deleteBookComment(book: CommentBook, id: string): Promise<void>;
  readBookCommentImage(book: CommentBook, id: string, imageId: string): Promise<BookCommentImageContent | null>;
}

function bookQuery(book: CommentBook): URLSearchParams {
  const query = new URLSearchParams({ folder: book.folder, filename: book.filename });
  if (book.driveFileId) query.set('driveFileId', book.driveFileId);
  return query;
}

export function bookCommentUrl(book: CommentBook): string {
  return `${BOOK_COMMENTS_PATH}?${bookQuery(book)}`;
}

export function bookCommentImageUrl(book: CommentBook, id: string, imageId: string): string {
  const query = bookQuery(book);
  query.set('id', id);
  query.set('imageId', imageId);
  return `${BOOK_COMMENTS_PATH}${BOOK_COMMENT_IMAGE_PATH}?${query}`;
}

export function isBookCommentImageType(value: unknown): value is BookCommentImageType {
  return BOOK_COMMENT_IMAGE_TYPES.some((type) => type === value);
}

export function parseBookCommentImage(value: unknown): BookCommentImage | null {
  if (!value || typeof value !== 'object' || !('id' in value) || !('name' in value) ||
    typeof value.id !== 'string' || !BOOK_COMMENT_ID.test(value.id) || typeof value.name !== 'string' ||
    !value.name.trim() || value.name.length > BOOK_COMMENT_IMAGE_NAME_LIMIT || value.name.includes('\0')) return null;
  return { id: value.id.toLowerCase(), name: value.name };
}

export function parseCommentBook(value: unknown): CommentBook | null {
  if (!value || typeof value !== 'object') return null;
  const { folder, filename, driveFileId } = value as Partial<CommentBook>;
  if (typeof folder !== 'string' || !folder || folder.includes('\0') ||
    typeof filename !== 'string' || !filename || filename.includes('\0') ||
    (driveFileId !== undefined && (typeof driveFileId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(driveFileId)))) return null;
  return { folder, filename, driveFileId };
}

export function isBookCommentReferencePage(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2_147_483_647;
}

export function parseBookCommentReferencePages(value: unknown): number[] | null {
  if (!Array.isArray(value) || !value.every(isBookCommentReferencePage)) return null;
  return [...new Set<number>(value)].sort((left, right) => left - right);
}

export function parseBookComment(value: unknown): BookComment | null {
  if (!value || typeof value !== 'object' || !('id' in value) || !('body' in value) ||
    !('createdAt' in value) || !('updatedAt' in value) ||
    typeof value.id !== 'string' || typeof value.body !== 'string' ||
    typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.updatedAt))) return null;
  const comment: BookComment = { id: value.id, body: value.body, createdAt: value.createdAt, updatedAt: value.updatedAt };
  if ('referencePages' in value && value.referencePages !== undefined) {
    const pages = parseBookCommentReferencePages(value.referencePages);
    if (!pages) return null;
    comment.referencePages = pages;
  }
  if (!('images' in value) || value.images === undefined) return comment;
  if (!Array.isArray(value.images) || value.images.length > BOOK_COMMENT_IMAGE_LIMIT) return null;
  const images = value.images.map(parseBookCommentImage);
  return images.every((image) => image !== null) ? { ...comment, images } : null;
}

export function parseBookCommentPage(value: unknown): BookCommentPage | null {
  if (!value || typeof value !== 'object' || !('comments' in value) || !Array.isArray(value.comments) ||
    !('page' in value) || !('total' in value) ||
    typeof value.page !== 'number' || !Number.isSafeInteger(value.page) || value.page < 1 ||
    typeof value.total !== 'number' || !Number.isSafeInteger(value.total) || value.total < 0 ||
    value.page > bookCommentPageCount(value.total)) return null;
  const expectedCount = Math.min(BOOK_COMMENT_PAGE_SIZE, value.total - (value.page - 1) * BOOK_COMMENT_PAGE_SIZE);
  if (value.comments.length !== expectedCount) return null;
  const comments = value.comments.map(parseBookComment);
  if (comments.some((comment) => comment === null)) return null;
  return { comments: comments.filter((comment) => comment !== null), page: value.page, total: value.total };
}

export function bookCommentPageCount(total: number): number {
  return Math.max(1, Math.ceil(total / BOOK_COMMENT_PAGE_SIZE));
}
