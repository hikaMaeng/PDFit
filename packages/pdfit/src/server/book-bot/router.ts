import { Router } from 'express';
import {
  BOOK_BOT_ID, BOOK_BOT_SESSIONS, BOOK_BOT_TURNS, BOOK_BOT_STREAM_TYPE, parseBookBotBook, parseBookBotQuestion,
  type BookBotBook, type BookBotSession, type BookBotTurn, type BookBotSessionPayload, type BookBotSessionsPayload,
} from '../../common/protocol/book-bot/index.js';
import { answerBookQuestion } from './answer.js';
import { openBookBotStream } from './stream.js';
import type { BookBotModelConfig, BookBotStore } from './types.js';

export interface BookBotOptions {
  store: BookBotStore;
  resolveModel: () => Promise<BookBotModelConfig | null>;
  resolveVision?: () => Promise<BookBotModelConfig | null>;
  getCachedPageText?: (book: BookBotBook, page: number) => Promise<string | null>;
  request?: typeof fetch;
}

export function createBookBotRouter(options: BookBotOptions): Router {
  const { store, request = fetch } = options;
  const router = Router();
  const running = new Set<string>();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const origin = req.get('origin');
    if (origin) {
      const valid = URL.canParse(origin) && new URL(origin).host === req.get('host');
      if (!valid) { res.status(403).end(); return; }
    }
    next();
  });
  router.get(BOOK_BOT_SESSIONS, async (req, res, next) => {
    const book = parseBookBotBook(req.query);
    if (!book || book.driveFileId) { res.status(400).end(); return; }
    try {
      const id = req.query.id;
      if (id === undefined) {
        res.json({ sessions: await store.list(book) } satisfies BookBotSessionsPayload);
        return;
      }
      if (typeof id !== 'string' || (id !== 'latest' && !BOOK_BOT_ID.test(id))) { res.status(400).end(); return; }
      const session = await store.get(book, id === 'latest' ? undefined : id);
      if (!session && id !== 'latest') { res.status(404).end(); return; }
      res.json({ session } satisfies BookBotSessionPayload);
    } catch (error) { next(error); }
  });
  router.post(BOOK_BOT_SESSIONS, async (req, res, next) => {
    const book = parseBookBotBook(req.query);
    const { id } = req.query;
    if (!book || book.driveFileId || typeof id !== 'string' || !BOOK_BOT_ID.test(id)) { res.status(400).end(); return; }
    try {
      const session = await store.create(book, id);
      if (!session) { res.status(404).end(); return; }
      res.status(201).json({ session } satisfies BookBotSessionPayload);
    } catch (error) { next(error); }
  });
  router.post(BOOK_BOT_TURNS, async (req, res, next) => {
    const book = parseBookBotBook(req.query);
    const input = parseBookBotQuestion(req.body);
    if (!book || book.driveFileId || !input) { res.status(400).end(); return; }
    const { sessionId, turnId, revision, question } = input;
    const key = JSON.stringify([book.folder, book.filename, sessionId ?? turnId]);
    if (running.has(key)) { res.status(409).end(); return; }
    running.add(key);
    const wantsStream = req.accepts(['json', BOOK_BOT_STREAM_TYPE]) === BOOK_BOT_STREAM_TYPE;
    let stream: ReturnType<typeof openBookBotStream> | undefined;
    const succeed = (session: BookBotSession, turn: BookBotTurn) => {
      if (wantsStream && !res.destroyed) {
        stream ??= openBookBotStream(res);
        const { id, title, createdAt, turns } = session;
        stream.write({ type: 'saved', session: { id, title, createdAt }, turn, revision: turns.length });
      } else if (!res.destroyed) res.json({ session } satisfies BookBotSessionPayload);
    };
    const fail = (status: 409 | 500 | 502) => {
      if (stream) stream.write({ type: 'error', status });
      else if (!res.destroyed) res.status(status).end();
    };
    try {
      const existing = await store.get(book, sessionId ?? turnId);
      const replay = existing?.turns.find((turn) => turn.id === turnId);
      if (existing && replay) {
        if (replay.question !== question) { res.status(409).end(); return; }
        succeed(existing, replay);
        return;
      }
      if (sessionId && !existing) { res.status(404).end(); return; }
      if ((existing?.turns.length ?? 0) !== revision) { res.status(409).end(); return; }
      const model = await options.resolveModel();
      if (!model) { res.status(503).end(); return; }
      const source = await store.source(book);
      if (!source) { res.status(404).end(); return; }
      if (source.outline === null) source.outline = input.embeddedOutline ?? null;
      if (wantsStream && !res.destroyed) stream = openBookBotStream(res);
      const vision = source.clips.length ? await options.resolveVision?.() : null;
      const result = await answerBookQuestion({
        model, vision, source, store, question, turns: existing?.turns ?? [], request,
        pageText: (page) => options.getCachedPageText?.(book, page) ?? Promise.resolve(null),
        onAnswerDelta: stream && ((text) => stream?.write({ type: 'delta', text })),
      }).catch((error: unknown) => {
        console.warn('[book-bot] generation failed:', error instanceof Error ? error.name : 'unknown');
        return null;
      });
      if (!result) { fail(502); return; }
      // A closed browser connection may be retried by turn ID. Finish saving upstream success.
      const turn = { id: turnId, question, answer: result.answer };
      const session = await store.saveTurn(book, sessionId, revision, turn, result.title);
      if (!session) { fail(409); return; }
      succeed(session, turn);
    } catch (error) {
      if (stream) {
        console.error('[book-bot] turn save failed:', error instanceof Error ? error.name : 'unknown');
        fail(500);
      } else next(error);
    } finally {
      stream?.close();
      running.delete(key);
    }
  });
  return router;
}
