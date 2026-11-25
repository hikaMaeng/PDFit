import { Router } from 'express';
import {
  BOOK_BOT_ID, BOOK_BOT_SESSIONS, BOOK_BOT_TURNS, parseBookBotBook, parseBookBotQuestion,
  type BookBotBook, type BookBotSessionPayload, type BookBotSessionsPayload,
} from '../../common/protocol/book-bot/index.js';
import { answerBookQuestion } from './answer.js';
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
    try {
      const existing = await store.get(book, sessionId ?? turnId);
      const replay = existing?.turns.find((turn) => turn.id === turnId);
      if (replay) {
        if (replay.question !== question) { res.status(409).end(); return; }
        res.json({ session: existing } satisfies BookBotSessionPayload);
        return;
      }
      if (sessionId && !existing) { res.status(404).end(); return; }
      if ((existing?.turns.length ?? 0) !== revision) { res.status(409).end(); return; }
      const model = await options.resolveModel();
      if (!model) { res.status(503).end(); return; }
      const source = await store.source(book);
      if (!source) { res.status(404).end(); return; }
      if (source.outline === null) source.outline = input.embeddedOutline ?? null;
      const vision = source.clips.length ? await options.resolveVision?.() : null;
      const result = await answerBookQuestion({
        model, vision, source, store, question, turns: existing?.turns ?? [], request,
        pageText: (page) => options.getCachedPageText?.(book, page) ?? Promise.resolve(null),
      }).catch((error: unknown) => {
        console.warn('[book-bot] generation failed:', error instanceof Error ? error.name : 'unknown');
        return null;
      });
      if (!result) { res.status(502).end(); return; }
      const session = await store.saveTurn(book, sessionId, revision, { id: turnId, question, answer: result.answer }, result.title);
      if (!session) { res.status(409).end(); return; }
      res.json({ session } satisfies BookBotSessionPayload);
    } catch (error) { next(error); }
    finally { running.delete(key); }
  });
  return router;
}
