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
}

export interface BookCommentPage {
  comments: BookComment[];
  page: number;
  total: number;
}

export const BOOK_COMMENTS_PATH = '/api/book-comments';
export const BOOK_COMMENT_LIMIT = 10_000;
export const BOOK_COMMENT_PAGE_SIZE = 5;
export const BOOK_COMMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface WriteBookComment {
  id: string;
  body: string;
}

export interface BookCommentStore {
  listBookComments(book: CommentBook, page: number): Promise<BookCommentPage>;
  createBookComment(book: CommentBook, input: WriteBookComment): Promise<BookComment | null>;
  updateBookComment(book: CommentBook, input: WriteBookComment): Promise<BookComment | null>;
  deleteBookComment(book: CommentBook, id: string): Promise<void>;
}

export function parseBookComment(value: unknown): BookComment | null {
  if (!value || typeof value !== 'object' || !('id' in value) || !('body' in value) ||
    !('createdAt' in value) || !('updatedAt' in value) ||
    typeof value.id !== 'string' || typeof value.body !== 'string' ||
    typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.updatedAt))) return null;
  return { id: value.id, body: value.body, createdAt: value.createdAt, updatedAt: value.updatedAt };
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
