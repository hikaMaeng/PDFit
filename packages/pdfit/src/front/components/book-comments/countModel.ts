import {
  BOOK_COMMENTS_PATH, BOOK_COMMENT_COUNTS_LIMIT, BOOK_COMMENT_COUNTS_PATH, parseCommentBook, type CommentBook,
} from '../../../common/protocol/book-comments/index.js';
import { publishWindowSyncMessage, subscribeWindowSyncMessage } from '../../model/windowSync.js';

const topic = 'book-comments.changed';
const bookKey = (book: CommentBook) => JSON.stringify([book.folder, book.filename, book.driveFileId]);

interface Entry {
  book: CommentBook;
  listeners: Set<() => void>;
  count?: number;
  revision: number;
}

const entries = new Map<string, Entry>();
const pending = new Set<Entry>();
let scheduled = false;

function enqueue(entry: Entry) {
  entry.revision += 1;
  pending.add(entry);
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => void loadBatch(), 0);
}

async function loadBatch() {
  const batch = Array.from(pending).slice(0, BOOK_COMMENT_COUNTS_LIMIT).map((entry) => {
    pending.delete(entry);
    return { entry, revision: entry.revision };
  });
  try {
    if (!batch.length) return;
    const response = await fetch(`${BOOK_COMMENTS_PATH}${BOOK_COMMENT_COUNTS_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ books: batch.map(({ entry }) => entry.book) }),
    });
    if (!response.ok) return;
    const counts: unknown = await response.json();
    if (!Array.isArray(counts) || counts.length !== batch.length ||
      counts.some((count) => !Number.isSafeInteger(count) || count < 0)) return;
    batch.forEach(({ entry, revision }, index) => {
      if (!entry.listeners.size || entry.revision !== revision || entry.count === counts[index]) return;
      entry.count = counts[index];
      entry.listeners.forEach((listener) => listener());
    });
  } catch {
    // Keep any previously loaded count when the request fails.
  } finally {
    if (pending.size) void loadBatch();
    else scheduled = false;
  }
}

export const bookCommentCountModel = {
  get(book: CommentBook) {
    return entries.get(bookKey(book))?.count;
  },

  subscribe(book: CommentBook, listener: () => void) {
    const key = bookKey(book);
    let entry = entries.get(key);
    if (!entry) {
      entry = { book, listeners: new Set(), revision: 0 };
      entries.set(key, entry);
      enqueue(entry);
    }
    const current = entry;
    current.listeners.add(listener);
    return () => {
      current.listeners.delete(listener);
      if (current.listeners.size) return;
      pending.delete(current);
      entries.delete(key);
    };
  },

  connect() {
    return subscribeWindowSyncMessage(topic, (payload) => {
      const book = parseCommentBook(payload);
      if (!book) return;
      const entry = entries.get(bookKey(book));
      if (entry) enqueue(entry);
    });
  },
};

export function publishBookCommentChange(book: CommentBook) {
  publishWindowSyncMessage(topic, book);
}
