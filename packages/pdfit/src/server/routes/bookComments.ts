import { Router } from 'express';
import sharp from 'sharp';
import {
  BOOK_COMMENT_COUNTS_LIMIT, BOOK_COMMENT_COUNTS_PATH, BOOK_COMMENT_ID, BOOK_COMMENT_LIMIT,
  BOOK_COMMENT_IMAGE_BYTES, BOOK_COMMENT_IMAGE_LIMIT, BOOK_COMMENT_IMAGE_PATH,
  isBookCommentImageType, isBookCommentReferencePage, parseBookCommentImage, parseBookCommentReferencePages, parseCommentBook,
  type BookComment, type BookCommentPage, type WriteBookCommentImage,
} from '../../common/protocol/book-comments/index.js';
import { resolveMetadataStore, type MetadataStoreResolver } from './metadataStoreResolver.js';

const maxEncodedBytes = Math.ceil(BOOK_COMMENT_IMAGE_BYTES / 3) * 4;
const maxInputPixels = 24_000_000;

async function parseImages(value: unknown, creating: boolean): Promise<WriteBookCommentImage[] | null> {
  if (!Array.isArray(value) || value.length > BOOK_COMMENT_IMAGE_LIMIT) return null;
  const images: WriteBookCommentImage[] = [];
  const seen = new Set<string>();
  for (const item of value as unknown[]) {
    if (!item || typeof item !== 'object' || !('id' in item) ||
      typeof item.id !== 'string' || !BOOK_COMMENT_ID.test(item.id)) return null;
    const id = item.id.toLowerCase();
    if (seen.has(id)) return null;
    seen.add(id);
    if (!('base64' in item)) {
      if (creating) return null;
      images.push({ id });
      continue;
    }
    const image = parseBookCommentImage(item);
    if (!image || !('mimeType' in item) || !isBookCommentImageType(item.mimeType) ||
      typeof item.base64 !== 'string' || !item.base64.length || item.base64.length > maxEncodedBytes ||
      item.base64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(item.base64)) return null;
    const data = Buffer.from(item.base64, 'base64');
    if (!data.length || data.length > BOOK_COMMENT_IMAGE_BYTES || data.toString('base64') !== item.base64) return null;
    try {
      const info = await sharp(data, { limitInputPixels: maxInputPixels }).metadata();
      if (!info.width || !info.height || info.width * info.height > maxInputPixels ||
        `image/${info.format}` !== item.mimeType) return null;
    } catch {
      return null;
    }
    images.push({ ...image, mimeType: item.mimeType, data });
  }
  return images;
}

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

  router.get(BOOK_COMMENT_IMAGE_PATH, async (req, res) => {
    const { folder, filename, driveFileId, id, imageId } = req.query;
    const book = parseCommentBook({ folder, filename, driveFileId });
    if (!book || typeof id !== 'string' || !BOOK_COMMENT_ID.test(id) ||
      typeof imageId !== 'string' || !BOOK_COMMENT_ID.test(imageId)) {
      res.status(400).end(); return;
    }
    try {
      const { bookComments: store } = await resolveMetadataStore(resolver, req);
      const image = await store?.readBookCommentImage(book, id.toLowerCase(), imageId.toLowerCase());
      if (!image || !isBookCommentImageType(image.mimeType)) { res.status(404).end(); return; }
      res.set('Cache-Control', 'private, no-store').set('X-Content-Type-Options', 'nosniff')
        .type(image.mimeType).send(Buffer.from(image.data));
    } catch (error) {
      console.error('[book-comments/image]', error);
      res.status(500).end();
    }
  });

  router.all('/', async (req, res) => {
    const { folder, filename, driveFileId, page = '1', referencePage, id } = req.query;
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
          const filter = referencePage === undefined ? undefined : Number(referencePage);
          if (referencePage !== undefined && (typeof referencePage !== 'string' ||
            !/^\d+$/.test(referencePage) || !isBookCommentReferencePage(filter))) { res.status(400).end(); return; }
          res.json(await store.listBookComments(book, offset, filter) satisfies BookCommentPage);
          return;
        }
        case 'POST':
        case 'PATCH': {
          const body: unknown = req.body?.body;
          const imageInput: unknown = req.body?.images;
          const pagesInput: unknown = req.body?.referencePages;
          if (typeof id !== 'string' || !BOOK_COMMENT_ID.test(id) || typeof body !== 'string' ||
            body.length > BOOK_COMMENT_LIMIT || body.includes('\0')) { res.status(400).end(); return; }
          const referencePages = pagesInput === undefined ? undefined : parseBookCommentReferencePages(pagesInput);
          if (referencePages === null) { res.status(400).end(); return; }
          const images = imageInput === undefined ? undefined : await parseImages(imageInput, req.method === 'POST');
          if (images === null || (!body.trim() && !images?.length)) { res.status(400).end(); return; }
          const input = { id: id.toLowerCase(), body, images, referencePages };
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
