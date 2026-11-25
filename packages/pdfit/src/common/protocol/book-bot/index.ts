import { BOOK_COMMENT_ID, parseCommentBook, type CommentBook } from '../book-comments/index.js';
import { parseBookOutlineEntries, type BookOutlineEntry } from '../outlines/index.js';

export const BOOK_BOT_PATH = '/api/book-bot';
export const BOOK_BOT_SESSIONS = '/sessions';
export const BOOK_BOT_TURNS = '/turns';
export const BOOK_BOT_QUESTION_LIMIT = 4000;
export const BOOK_BOT_ID = BOOK_COMMENT_ID;

export type BookBotBook = CommentBook;

export interface BookBotSessionSummary {
  id: string;
  title: string | null;
  createdAt: string;
}

export interface BookBotTurn {
  id: string;
  question: string;
  answer: string;
}

export interface BookBotSession extends BookBotSessionSummary {
  turns: BookBotTurn[];
}

export interface BookBotSessionsPayload {
  sessions: BookBotSessionSummary[];
}

export interface BookBotSessionPayload {
  session: BookBotSession | null;
}

export interface BookBotQuestion {
  sessionId: string | null;
  turnId: string;
  revision: number;
  question: string;
  embeddedOutline?: BookOutlineEntry[];
}

export function parseBookBotBook(value: unknown): BookBotBook | null {
  const book = parseCommentBook(value);
  return book && book.folder.length <= 1024 && book.filename.length <= 1024 ? book : null;
}

export function parseBookBotQuestion(value: unknown): BookBotQuestion | null {
  if (!value || typeof value !== 'object') return null;
  const { sessionId, turnId, revision, question, embeddedOutline } = value as Record<string, unknown>;
  if (sessionId !== null && (typeof sessionId !== 'string' || !BOOK_BOT_ID.test(sessionId))) return null;
  if (typeof turnId !== 'string' || !BOOK_BOT_ID.test(turnId) || typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) || revision < 0 || (sessionId === null && revision !== 0) ||
    typeof question !== 'string' || !question.trim() || question.length > BOOK_BOT_QUESTION_LIMIT || question.includes('\0')) return null;
  const outline = embeddedOutline === undefined ? undefined : parseBookOutlineEntries(embeddedOutline);
  if (outline === null) return null;
  return { sessionId, turnId, revision, question: question.trim(), embeddedOutline: outline };
}

function parseSummary(value: unknown): BookBotSessionSummary | null {
  if (!value || typeof value !== 'object') return null;
  const { id, title, createdAt } = value as Record<string, unknown>;
  if (typeof id !== 'string' || !BOOK_BOT_ID.test(id) || (title !== null && typeof title !== 'string') ||
    typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))) return null;
  return { id, title, createdAt };
}

export function parseBookBotSessions(value: unknown): BookBotSessionsPayload | null {
  if (!value || typeof value !== 'object' || !('sessions' in value) || !Array.isArray(value.sessions)) return null;
  const sessions = value.sessions.map(parseSummary);
  return sessions.every((session) => session !== null) ? { sessions } : null;
}

export function parseBookBotSession(value: unknown): BookBotSessionPayload | null {
  if (!value || typeof value !== 'object' || !('session' in value)) return null;
  const entry = value.session;
  if (entry === null) return { session: null };
  const summary = parseSummary(entry);
  if (!summary || !entry || typeof entry !== 'object' || !('turns' in entry) || !Array.isArray(entry.turns)) return null;
  const turns: BookBotTurn[] = [];
  for (const turn of entry.turns) {
    if (typeof turn?.id !== 'string' || !BOOK_BOT_ID.test(turn.id) ||
      typeof turn.question !== 'string' || typeof turn.answer !== 'string') return null;
    turns.push({ id: turn.id, question: turn.question, answer: turn.answer });
  }
  return { session: { ...summary, turns } };
}
