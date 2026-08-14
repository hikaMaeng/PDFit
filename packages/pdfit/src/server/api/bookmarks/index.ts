import { Router, type Request, type Response, type Router as ExpressRouter } from 'express';
import type { CreateBookmarkRequest, UpdateBookmarkRequest } from '../../../common/protocol/bookmarks/index.js';
import type { MetadataStore } from '../../../shared/index.js';

function validColor(value: unknown): value is string { return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value); }
function validRequest(value: unknown): value is CreateBookmarkRequest {
  if (!value || typeof value !== 'object') return false;
  const body = value as CreateBookmarkRequest;
  return Number.isInteger(body.pageIndex) && body.pageIndex >= 0 && body.rect != null &&
    body.rect.x >= 0 && body.rect.y >= 0 && body.rect.width > 0 && body.rect.height > 0 &&
    Number.isFinite(body.rect.x + body.rect.width) && Number.isFinite(body.rect.y + body.rect.height) &&
    validColor(body.borderColor) && (body.fillColor == null || validColor(body.fillColor)) &&
    (body.fillOpacity == null || (body.fillOpacity >= 0 && body.fillOpacity <= 1)) &&
    (body.imageMimeType === 'image/png' || body.imageMimeType === 'image/webp') && typeof body.imageBase64 === 'string' && body.imageBase64.length > 0;
}

export function createBookmarksRouter(store: MetadataStore): ExpressRouter {
  const router = Router();
  router.get('/', async (_req: Request, res: Response) => res.json(await store.listAllBookmarks()));
  router.get('/:folder/:filename', async (req: Request, res: Response) => res.json(await store.listBookmarks(req.params.folder, req.params.filename)));
  router.post('/:folder/:filename', async (req: Request, res: Response) => {
    if (!validRequest(req.body)) return res.status(400).json({ error: 'invalid bookmark' });
    return res.status(201).json(await store.createBookmark(req.params.folder, req.params.filename, req.body));
  });
  router.patch('/:id', async (req: Request, res: Response) => {
    const body = req.body as UpdateBookmarkRequest;
    if (body.borderColor !== undefined && !validColor(body.borderColor)) return res.status(400).json({ error: 'invalid border color' });
    if (body.fillColor !== undefined && body.fillColor !== null && !validColor(body.fillColor)) return res.status(400).json({ error: 'invalid fill color' });
    if (body.fillOpacity !== undefined && (body.fillOpacity < 0 || body.fillOpacity > 1)) return res.status(400).json({ error: 'invalid opacity' });
    const result = await store.updateBookmark(req.params.id, body);
    return result ? res.json(result) : res.status(404).json({ error: 'bookmark not found' });
  });
  router.delete('/:id', async (req: Request, res: Response) => { await store.deleteBookmark(req.params.id); return res.status(204).end(); });
  return router;
}
