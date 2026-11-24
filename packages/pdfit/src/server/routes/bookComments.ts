import { Router } from 'express';
import { BOOK_COMMENT_ID, BOOK_COMMENT_LIMIT, type BookComment, type BookCommentPage, type CommentBook } from '../../common/protocol/book-comments/index.js';
import { resolveMetadataStore, type MetadataStoreResolver } from './metadataStoreResolver.js';

export function createBookCommentsRouter(resolver: MetadataStoreResolver): Router {
  const router = Router();
  router.all('/', async (req, res) => {
    const { folder, filename, driveFileId, page = '1', id } = req.query;
    if (typeof folder !== 'string' || !folder || typeof filename !== 'string' || !filename ||
      (driveFileId !== undefined && (typeof driveFileId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(driveFileId)))) {
      res.status(400).end(); return;
    }
    const book: CommentBook = { folder, filename, driveFileId };
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
          const input = { id, body: body.trim() };
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
