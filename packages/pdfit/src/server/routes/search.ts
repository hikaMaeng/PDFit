import { Router, type Request, type Response } from 'express';
import { resolveMetadataStore, type MetadataStoreResolver } from './metadataStoreResolver.js';

export const SEARCH_QUERY_MAX_LENGTH = 200;

/** DB(`books` 테이블) 기준 도서 검색. 현재는 책 제목만 대상으로 한다. */
export function createSearchRouter(metadataStoreResolver: MetadataStoreResolver): Router {
  const router = Router();

  router.get('/books', async (req: Request, res: Response) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!query) { res.status(400).json({ error: 'A search query is required.' }); return; }
    if (query.length > SEARCH_QUERY_MAX_LENGTH) { res.status(400).json({ error: 'The search query is too long.' }); return; }
    try {
      const metadataStore = await resolveMetadataStore(metadataStoreResolver, req);
      if (!metadataStore.searchBooksByTitle) { res.status(501).json({ error: 'Title search is not available for this library.' }); return; }
      const limit = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : undefined;
      res.json({ query, ...(await metadataStore.searchBooksByTitle(query, Number.isFinite(limit) ? limit : undefined)) });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
