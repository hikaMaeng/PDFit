import type { BookBotBook, BookBotSession, BookBotSessionSummary, BookBotTurn } from '../../common/protocol/book-bot/index.js';
import type { BookmarkRecord } from '../../common/protocol/bookmarks/index.js';
import type { BookOutlineEntry } from '../../common/protocol/outlines/index.js';

export interface BookBotSource {
  title: string;
  outline: BookOutlineEntry[] | null;
  pages: Array<{ page: number; text: string }>;
  clips: BookmarkRecord[];
  comments: Array<{ id: string; body: string; createdAt: string }>;
}

export interface BookBotStore {
  list(book: BookBotBook): Promise<BookBotSessionSummary[]>;
  get(book: BookBotBook, id?: string): Promise<BookBotSession | null>;
  create(book: BookBotBook, id: string): Promise<BookBotSession | null>;
  saveTurn(book: BookBotBook, sessionId: string | null, revision: number, turn: BookBotTurn, title: string | null): Promise<BookBotSession | null>;
  source(book: BookBotBook): Promise<BookBotSource | null>;
  clipDescription?(clip: BookmarkRecord, modelKey: string, describe: (image: Buffer) => Promise<string>): Promise<string | null>;
}

export interface BookBotModelConfig {
  baseUrl: string;
  model: string;
  headers?: Record<string, string>;
}
