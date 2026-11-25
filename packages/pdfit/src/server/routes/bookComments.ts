import { Router } from 'express';
import {
  BOOK_COMMENT_COUNTS_LIMIT, BOOK_COMMENT_COUNTS_PATH, BOOK_COMMENT_ID, BOOK_COMMENT_LIMIT,
  parseCommentBook, type BookComment, type BookCommentPage,
} from '../../common/protocol/book-comments/index.js';
import { resolveMetadataStore, type MetadataStoreResolver } from './metadataStoreResolver.js';

export function createBookCommentsRouter(resolver: MetadataStoreResolver): Router {
  const router = Router();
  router.post(BOOK_COMMENT_COUNTS_PATH, async (req, res) => {
    const input: unknown = req.body?.books;
    if (!Array.isArray(input) || input.length === 0 || input.length > BOOK_COMMENT_COUNTS_LIMIT) {
      res.status(400).end(); return;
    }
    const books = input.map(parseCommentBook);
    if (books.some((book) => book === null)) { res.status(400).end(); return; }
    try {
      const { bookComments: store } = await resolveMetadataStore(resolver, req);
      if (!store) { res.status(501).end(); return; }
      res.set('Cache-Control', 'no-store').json(await store.listBookCommentCounts(books.filter((book) => book !== null)));
    } catch (error) {
      console.error('[book-comments]', error);
      res.status(500).end();
    }
  });

  router.all('/', async (req, res) => {
    const { folder, filename, driveFileId, page = '1', id } = req.query;
    const book = parseCommentBook({ folder, filename, driveFileId });
    if (!book) { res.status(400).end(); return; }
    try {
      const { bookComments: store } = await resolveMetadataStore(resolver, req);
      if (!store) { res.status(501).end(); return; }
      res.set('Cache-Control', 'no-store');
      switch (req.method) {
        case 'GET': {
          const offset = Number(page);
          if (typeof page !== 'string' || !Number.isSafeInteger(offset) || offset < 1) { res.status(400).end(); return; }
          res.json(await store.listBookComments(book, offset) satisfies BookCommentPage);
          return;
        }
        case 'POST':
        case 'PATCH': {
          const body: unknown = req.body?.body;
          if (typeof id !== 'string' || !BOOK_COMMENT_ID.test(id) || typeof body !== 'string' ||
            !body.trim() || body.length > BOOK_COMMENT_LIMIT || body.includes('\0')) { res.status(400).end(); return; }
          const input = { id, body };
          const saved = req.method === 'POST' ? await store.createBookComment(book, input) : await store.updateBookComment(book, input);
          if (!saved) { res.status(404).end(); return; }
          res.status(req.method === 'POST' ? 201 : 200).json(saved satisfies BookComment);
          return;
        }
        case 'DELETE':
          if (typeof id !== 'string' || !BOOK_COMMENT_ID.test(id)) { res.status(400).end(); return; }
          await store.deleteBookComment(book, id);
          res.status(204).end();
          return;
        default: res.sendStatus(405);
      }
    } catch (error) {
      console.error('[book-comments]', error);
      res.status(500).end();
    }
  });
  return router;
}
