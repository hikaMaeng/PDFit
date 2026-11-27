import {
  BOOK_BOT_PATH, BOOK_BOT_PROGRESS_HEADER, BOOK_BOT_PROGRESS_VERSION, BOOK_BOT_SESSIONS, BOOK_BOT_TURNS, BOOK_BOT_STREAM_TYPE, parseBookBotSession, parseBookBotSessions,
  parseBookBotStreamEvent,
  type BookBotBook, type BookBotProgress, type BookBotQuestion, type BookBotSession, type BookBotSessionSummary,
} from '../../../common/protocol/book-bot/index.js';
import { readServerSentData } from '../../../common/protocol/server-sent-data.js';
import { createBrowserUuid } from '../../browserUuid.js';
import { outlinesApi } from '../../api/outlines.js';
import { readPdfOutlineFromUrl } from '../../viewer/readPdfOutlineFromUrl.js';
import type { BookOutlineEntry } from '../../../common/protocol/outlines/index.js';

type Phase = 'ready' | 'loading' | 'sending';
type Failure = 'load' | 'send' | 'settings' | 'conflict';

async function readTurnStream(response: Response, onDelta: (text: string) => void, onProgress: (progress: BookBotProgress) => void) {
  if (!response.body) throw new Error('Missing Bot stream');
  for await (const frame of readServerSentData(response.body)) {
    const event = parseBookBotStreamEvent(JSON.parse(frame));
    if (!event) throw new Error('Invalid Bot stream event');
    if (event.type === 'delta') onDelta(event.text);
    else if (event.type === 'progress') onProgress(event);
    else return event;
  }
  throw new Error('Bot stream ended before saving');
}

class BookBotModel {
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private readonly bookQuery: URLSearchParams;
  private attempted: BookBotQuestion | null = null;
  private retryLoad: (() => Promise<void>) | null = null;
  private outline: Promise<BookOutlineEntry[] | undefined> | null = null;

  open = false;
  history = false;
  phase: Phase = 'ready';
  error: Failure | null = null;
  session: BookBotSession | null = null;
  sessions: BookBotSessionSummary[] = [];
  draft = '';
  pending = '';
  pendingAnswer = '';
  progress: BookBotProgress | null = null;

  constructor(private readonly book: BookBotBook) {
    this.bookQuery = new URLSearchParams({ folder: book.folder, filename: book.filename });
    if (book.driveFileId) this.bookQuery.set('driveFileId', book.driveFileId);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getVersion = () => this.version;

  private emit() {
    this.version += 1;
    this.listeners.forEach((listener) => listener());
  }

  private url(path: string, id?: string) {
    const query = new URLSearchParams(this.bookQuery);
    if (id) query.set('id', id);
    return `${BOOK_BOT_PATH}${path}?${query}`;
  }

  toggle() {
    if (this.open) { this.close(); return; }
    this.open = true;
    this.history = false;
    this.outline = null;
    if (this.phase === 'ready') {
      // Replay an uncertain send after reopening without replacing its session or operation ID.
      if (this.attempted) this.emit();
      else void this.loadSession('latest');
    } else this.emit();
  }

  close() {
    this.open = false;
    this.emit();
  }

  edit(text: string) {
    if (this.phase !== 'ready') return;
    this.draft = text;
    if (text.trim() !== this.attempted?.question) this.attempted = null;
    this.emit();
  }

  showChat() {
    this.history = false;
    this.error = null;
    this.emit();
  }

  loadHistory = () => this.load(async () => {
    this.history = true;
    const response = await fetch(this.url(BOOK_BOT_SESSIONS));
    const result = response.ok ? parseBookBotSessions(await response.json()) : null;
    if (!result) throw new Error('Failed to load Bot sessions');
    this.sessions = result.sessions;
  });

  loadSession = (id: string) => this.load(async () => {
    const response = await fetch(this.url(BOOK_BOT_SESSIONS, id));
    const result = response.ok ? parseBookBotSession(await response.json()) : null;
    if (!result) throw new Error('Failed to load Bot conversation');
    if (id !== 'latest' || result.session?.id !== this.session?.id) this.draft = '';
    this.session = result.session;
    this.attempted = null;
    this.history = false;
  });

  newSession() {
    const id = createBrowserUuid();
    return this.load(async () => {
      const response = await fetch(this.url(BOOK_BOT_SESSIONS, id), { method: 'POST' });
      const result = response.ok ? parseBookBotSession(await response.json()) : null;
      if (!result?.session) throw new Error('Failed to create Bot session');
      this.session = result.session;
      this.draft = '';
      this.attempted = null;
      this.history = false;
    });
  }

  retry() { void this.retryLoad?.(); }

  private async load(action: () => Promise<void>) {
    if (this.phase !== 'ready') return;
    this.phase = 'loading';
    this.error = null;
    this.retryLoad = () => this.load(action);
    this.emit();
    try {
      await action();
      this.retryLoad = null;
    } catch {
      this.error = 'load';
    } finally {
      this.phase = 'ready';
      this.emit();
    }
  }

  private async readEmbeddedOutline(documentUrl: string) {
    const { folder, filename, driveFileId } = this.book;
    const stored = await outlinesApi.getStored(folder, filename, driveFileId);
    if (stored !== null) return undefined;
    const result = await readPdfOutlineFromUrl(documentUrl);
    return result.status === 'ok' ? result.entries : undefined;
  }

  private async handleConflict(input: BookBotQuestion) {
    this.error = 'conflict';
    if (!input.sessionId) return;
    const refreshed = await fetch(this.url(BOOK_BOT_SESSIONS, input.sessionId));
    const result = refreshed.ok ? parseBookBotSession(await refreshed.json()) : null;
    if (!result?.session || result.session.turns.length === input.revision) return;
    this.session = result.session;
    if (result.session.turns.some((turn) => turn.id === input.turnId)) this.draft = '';
    this.attempted = null;
  }

  async send(documentUrl: string) {
    const question = this.draft.trim();
    if (!question || this.phase !== 'ready' || this.error === 'load') return;
    const input: BookBotQuestion = this.attempted ?? {
      question, sessionId: this.session?.id ?? null, turnId: createBrowserUuid(),
      revision: this.session?.turns.length ?? 0,
    };
    this.attempted = input;
    this.pending = question;
    this.progress = { phase: 'preparing' };
    this.phase = 'sending';
    this.error = null;
    this.emit();
    try {
      const outline = this.outline ??= this.readEmbeddedOutline(documentUrl).catch(() => undefined);
      input.embeddedOutline = await outline;
      const response = await fetch(this.url(BOOK_BOT_TURNS), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: BOOK_BOT_STREAM_TYPE, [BOOK_BOT_PROGRESS_HEADER]: BOOK_BOT_PROGRESS_VERSION },
        body: JSON.stringify(input),
      });
      if (response.status === 503) { this.error = 'settings'; return; }
      if (response.status === 409) { await this.handleConflict(input); return; }
      if (!response.ok) throw new Error('Failed to send Bot message');
      if (response.headers.get('content-type')?.split(';', 1)[0] === BOOK_BOT_STREAM_TYPE) {
        const event = await readTurnStream(response, (text) => {
          this.pendingAnswer += text;
          this.emit();
        }, (progress) => {
          this.progress = progress;
          this.emit();
        });
        if (event.type === 'error') {
          if (event.status === 409) { await this.handleConflict(input); return; }
          throw new Error('Failed to complete Bot message');
        }
        if (event.turn.id !== input.turnId || (input.sessionId !== null && event.session.id !== input.sessionId)) {
          throw new Error('Bot stream confirmed a different turn');
        }
        if (event.revision === input.revision + 1) {
          this.session = { ...event.session, turns: [...(this.session?.turns ?? []), event.turn] };
        } else {
          const refreshed = await fetch(this.url(BOOK_BOT_SESSIONS, event.session.id));
          const result = refreshed.ok ? parseBookBotSession(await refreshed.json()) : null;
          if (!result?.session) throw new Error('Could not reload the saved Bot session');
          this.session = result.session;
        }
      } else {
        const result = parseBookBotSession(await response.json());
        if (!result?.session) throw new Error('Failed to send Bot message');
        this.session = result.session;
      }
      this.draft = '';
      this.attempted = null;
    } catch {
      this.error = 'send';
    } finally {
      this.pending = '';
      this.pendingAnswer = '';
      this.progress = null;
      this.phase = 'ready';
      this.emit();
    }
  }
}

const bookBots = new Map<string, BookBotModel>();

export function getBookBotModel(book: BookBotBook) {
  const key = JSON.stringify([book.folder, book.filename, book.driveFileId]);
  let model = bookBots.get(key);
  if (!model) {
    model = new BookBotModel(book);
    bookBots.set(key, model);
  }
  return model;
}
