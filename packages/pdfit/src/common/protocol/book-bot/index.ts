import { BOOK_COMMENT_ID, parseCommentBook, type CommentBook } from '../book-comments/index.js';
import { parseBookOutlineEntries, type BookOutlineEntry } from '../outlines/index.js';

export const BOOK_BOT_PATH = '/api/book-bot';
export const BOOK_BOT_SESSIONS = '/sessions';
export const BOOK_BOT_TURNS = '/turns';
export const BOOK_BOT_QUESTION_LIMIT = 4000;
export const BOOK_BOT_ID = BOOK_COMMENT_ID;
export const BOOK_BOT_STREAM_TYPE = 'text/event-stream';
export const BOOK_BOT_PROGRESS_HEADER = 'X-PDFit-Bot-Progress';
export const BOOK_BOT_PROGRESS_VERSION = '2';
export const BOOK_BOT_MIN_CONTEXT_TOKENS = 16_384;
export const BOOK_BOT_MAX_CONTEXT_TOKENS = 2_097_152;

export type BookBotProgress =
  | { phase: 'preparing' | 'queued' | 'generating' | 'thinking' | 'saving' }
  | { phase: 'clips' | 'history' | 'evidence'; completed: number; total: number };

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

export type BookBotStreamEvent =
  | { type: 'delta'; text: string }
  | ({ type: 'progress' } & BookBotProgress)
  | { type: 'saved'; session: BookBotSessionSummary; turn: BookBotTurn; revision: number }
  | { type: 'error'; status: 409 | 500 | 502 };

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

function parseTurn(value: unknown): BookBotTurn | null {
  if (!value || typeof value !== 'object') return null;
  const { id, question, answer } = value as Record<string, unknown>;
  return typeof id === 'string' && BOOK_BOT_ID.test(id) && typeof question === 'string' && typeof answer === 'string'
    ? { id, question, answer } : null;
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
  for (const row of entry.turns) {
    const turn = parseTurn(row);
    if (!turn) return null;
    turns.push(turn);
  }
  return { session: { ...summary, turns } };
}

export function parseBookBotStreamEvent(value: unknown): BookBotStreamEvent | null {
  if (!value || typeof value !== 'object' || !('type' in value)) return null;
  if (value.type === 'delta' && 'text' in value && typeof value.text === 'string') {
    return { type: 'delta', text: value.text };
  }
  if (value.type === 'progress' && 'phase' in value) {
    const { phase } = value;
    if (phase === 'preparing' || phase === 'queued' || phase === 'generating' || phase === 'thinking' || phase === 'saving') {
      return { type: 'progress', phase };
    }
    if ((phase === 'clips' || phase === 'history' || phase === 'evidence') &&
      'completed' in value && typeof value.completed === 'number' && Number.isSafeInteger(value.completed) &&
      'total' in value && typeof value.total === 'number' && Number.isSafeInteger(value.total) &&
      value.total > 0 && value.completed >= 0 && value.completed <= value.total) {
      return { type: 'progress', phase, completed: value.completed, total: value.total };
    }
  }
  if (value.type === 'saved') {
    const session = 'session' in value ? parseSummary(value.session) : null;
    const turn = 'turn' in value ? parseTurn(value.turn) : null;
    const revision = 'revision' in value ? value.revision : null;
    return session && turn && typeof revision === 'number' && Number.isSafeInteger(revision) && revision > 0
      ? { type: 'saved', session, turn, revision } : null;
  }
  if (value.type === 'error' && 'status' in value && (value.status === 409 || value.status === 500 || value.status === 502)) {
    return { type: 'error', status: value.status };
  }
  return null;
}

export function isBookBotContextTokens(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) &&
    value >= BOOK_BOT_MIN_CONTEXT_TOKENS && value <= BOOK_BOT_MAX_CONTEXT_TOKENS;
}
