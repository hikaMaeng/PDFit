import type { EventEmitter } from 'node:events';
import { Router, type Request, type Response } from 'express';
import { resolveMetadataStore, type MetadataStoreResolver } from './metadataStoreResolver.js';

/**
 * 즐겨찾기(`/api/favorites`). 모든 응답은 DB(`book_favorites` + `books`)만 읽고 쓴다.
 * 실제 파일이 지워졌는지는 여기서 확인하지 않는다. 감시기·파일 삭제·폴더 이동이 부르는
 * `purgeFile`/`purgeFolder`가 그 시점에 즐겨찾기 행도 함께 지운다.
 */
export function createFavoritesRouter(metadataStoreResolver: MetadataStoreResolver, bus?: EventEmitter): Router {
  const router = Router();

  const unavailable = (res: Response) => res.status(501).json({ error: 'Favorites are not available for this library.' });

  router.get('/', async (req: Request, res: Response) => {
    try {
      const store = await resolveMetadataStore(metadataStoreResolver, req);
      if (!store.listFavoriteKeys) { unavailable(res); return; }
      res.json(await store.listFavoriteKeys());
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/books', async (req: Request, res: Response) => {
    try {
      const store = await resolveMetadataStore(metadataStoreResolver, req);
      if (!store.listFavoriteBooks) { unavailable(res); return; }
      res.json(await store.listFavoriteBooks());
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  const toggle = (favorite: boolean) => async (req: Request, res: Response) => {
    try {
      const store = await resolveMetadataStore(metadataStoreResolver, req);
      if (!store.setFavorite) { unavailable(res); return; }
      const { folder, filename } = req.params;
      const value = await store.setFavorite(folder, filename, favorite);
      bus?.emit('change', 'favorites-changed');
      res.json({ ok: true, favorite: value });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  };

  router.put('/:folder/:filename', toggle(true));
  router.delete('/:folder/:filename', toggle(false));

  return router;
}
