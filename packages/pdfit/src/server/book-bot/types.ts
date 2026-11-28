import type { BookBotBook, BookBotContext, BookBotSession, BookBotSessionSummary, BookBotTurn } from '../../common/protocol/book-bot/index.js';
import type { AiModelProgress } from '../../common/protocol/ai-model/index.js';
import type { SemanticSearchResult } from '../../common/protocol/embedding-search/index.js';

export type BookBotVectorSearch =
  (book: BookBotBook, query: string, onProgress?: (phase: AiModelProgress) => void) => Promise<SemanticSearchResult>;
export type BookBotCatalogBook = Pick<BookBotBook, 'folder' | 'filename'> & { title: string };
export type BookBotRelatedBook = BookBotCatalogBook & { sharedTags: string[] };
export type BookBotPageRange = { first: number; last: number | null };
export type BookBotPage = { page: number; text: string };
export type BookBotClip = { id: string; page: number; createdAt: string; ocr: string | null; comment: string | null; imageDescription: string | null };
export type BookBotComment = { id: string; body: string; createdAt: string };
export type BookBotHistoryPage = { page: number; tokens: number };
export type BookBotStoredTurn = BookBotTurn & { outlineKeys?: string[]; addedPages?: BookBotHistoryPage[] };
export type BookBotHistorySummary = { through: number; text: string };
export type BookBotStoredSession = Omit<BookBotSession, 'turns'> & {
  turns: BookBotStoredTurn[];
  historySummary: BookBotHistorySummary | null;
};

export interface BookBotStore {
  list(book: BookBotBook): Promise<BookBotSessionSummary[]>;
  get(book: BookBotBook, id?: string): Promise<BookBotStoredSession | null>;
  create(book: BookBotBook, id: string): Promise<BookBotStoredSession | null>;
  saveTurn(book: BookBotBook, sessionId: string | null, revision: number, turn: BookBotStoredTurn, title: string | null,
    historySummary: BookBotHistorySummary | null): Promise<BookBotStoredSession | null>;
  source(book: BookBotBook): Promise<BookBotContext | null>;
  relatedBooks(book: BookBotBook): Promise<BookBotRelatedBook[]>;
  findBooks(name: string, folder?: string): Promise<BookBotCatalogBook[]>;
  pages(book: BookBotBook, ranges: BookBotPageRange[]): Promise<BookBotPage[]>;
  clips(book: BookBotBook, ranges: BookBotPageRange[]): Promise<BookBotClip[]>;
  comments(book: BookBotBook): Promise<BookBotComment[]>;
}

export interface BookBotModelConfig {
  baseUrl: string;
  model: string;
  headers?: Record<string, string>;
  ocrConcurrency?: number;
  timeoutMs?: number;
  contextTokens?: number | null;
}
