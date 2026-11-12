import { Router, type Request, type RequestHandler, type Response, type Router as ExpressRouter } from 'express';
import type { CreateBookmarkRequest, UpdateBookmarkRequest } from '../../../common/protocol/bookmarks/index.js';
import { resolveMetadataStore, type MetadataStoreResolver } from '../../routes/metadataStoreResolver.js';

/** Clip OCR hook (local runtime). Absent where the runtime does not run OCR. */
export interface BookmarkOcrQueue {
  enqueueBookmark(bookmark: import('../../../common/protocol/bookmarks/index.js').BookmarkRecord): Promise<boolean>;
}

const BOOKMARK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validColor(value: unknown): value is string { return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value); }
function validRequest(value: unknown): value is CreateBookmarkRequest {
  if (!value || typeof value !== 'object') return false;
  const body = value as CreateBookmarkRequest;
  return Number.isInteger(body.pageIndex) && body.pageIndex >= 0 && body.rect != null &&
    body.rect.x >= 0 && body.rect.y >= 0 && body.rect.width > 0 && body.rect.height > 0 &&
    Number.isFinite(body.rect.x + body.rect.width) && Number.isFinite(body.rect.y + body.rect.height) &&
    validColor(body.borderColor) && (body.fillColor == null || validColor(body.fillColor)) &&
    (body.fillOpacity == null || (body.fillOpacity >= 0 && body.fillOpacity <= 1)) &&
    (body.imageMimeType === 'image/png' || body.imageMimeType === 'image/webp') && typeof body.imageBase64 === 'string' && body.imageBase64.length > 0 &&
    (body.operationId == null || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.operationId));
}

function asyncRoute(handler: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return (req, res, next) => { void handler(req, res).catch(next); };
}

export function createBookmarksRouter(storeResolver: MetadataStoreResolver, ocr?: BookmarkOcrQueue): ExpressRouter {
  const router = Router();
  router.get('/', asyncRoute(async (req, res) => res.json(await (await resolveMetadataStore(storeResolver, req)).listAllBookmarks())));
  router.get('/:folder/:filename', asyncRoute(async (req, res) => res.json(await (await resolveMetadataStore(storeResolver, req)).listBookmarks(req.params.folder, req.params.filename, typeof req.query.driveFileId === 'string' ? req.query.driveFileId : undefined))));
  // Reads the clip's text again, for example after an AI server was configured.
  // Registered before the create route, which would otherwise take `/<id>/ocr` as
  // folder `<id>` and file `ocr`. A non-UUID id falls through to that route.
  router.post('/:id/ocr', (req, res, next) => { if (!BOOKMARK_ID_PATTERN.test(req.params.id)) { next(); return; } asyncRoute(async () => {
    const store = await resolveMetadataStore(storeResolver, req);
    if (!ocr || !store.getBookmark || !store.setBookmarkOcr) return res.status(501).json({ error: 'Clip OCR is not available in this runtime.' });
    const bookmark = await store.getBookmark(req.params.id);
    if (!bookmark) return res.status(404).json({ error: 'bookmark not found' });
    if (!(await ocr.enqueueBookmark(bookmark))) return res.status(404).json({ error: 'The clip\'s PDF is not in the local library.' });
    return res.status(202).json({ status: 'pending' });
  })(req, res, next); });
  router.post('/:folder/:filename', asyncRoute(async (req, res) => {
    if (!validRequest(req.body)) return res.status(400).json({ error: 'invalid bookmark' });
    const store = await resolveMetadataStore(storeResolver, req);
    const driveFileId = typeof req.query.driveFileId === 'string' ? req.query.driveFileId : undefined;
    const created = await store.createBookmark(req.params.folder, req.params.filename, req.body, driveFileId);
    // OCR runs after the response: the clip is saved even when no text can be read.
    if (ocr && !driveFileId && store.setBookmarkOcr) {
      const queued = await ocr.enqueueBookmark(created).catch(() => false);
      if (queued) return res.status(201).json({ ...created, ocr: { status: 'pending', text: null, source: null, error: null, updatedAt: null } });
    }
    return res.status(201).json(created);
  }));
  router.patch('/:id', asyncRoute(async (req, res) => {
    const body = req.body as UpdateBookmarkRequest;
    if (body.borderColor !== undefined && !validColor(body.borderColor)) return res.status(400).json({ error: 'invalid border color' });
    if (body.fillColor !== undefined && body.fillColor !== null && !validColor(body.fillColor)) return res.status(400).json({ error: 'invalid fill color' });
    if (body.fillOpacity !== undefined && (body.fillOpacity < 0 || body.fillOpacity > 1)) return res.status(400).json({ error: 'invalid opacity' });
    const store = await resolveMetadataStore(storeResolver, req);
    const result = await store.updateBookmark(req.params.id, body);
    return result ? res.json(result) : res.status(404).json({ error: 'bookmark not found' });
  }));
  router.delete('/:id', asyncRoute(async (req, res) => { await (await resolveMetadataStore(storeResolver, req)).deleteBookmark(req.params.id); return res.status(204).end(); }));
  return router;
}
