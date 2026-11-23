import { Router, type Request, type Response } from 'express';
import { resolveMetadataStore, type MetadataStoreResolver } from './metadataStoreResolver.js';
import { isContentSearchScope } from '../../common/protocol/search/index.js';

export const SEARCH_QUERY_MAX_LENGTH = 200;

/** Title and individual content searches use the current library's metadata store. */
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

  router.get('/content/:scope', async (req: Request, res: Response) => {
    const { scope } = req.params;
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!isContentSearchScope(scope) || !query || query.length > SEARCH_QUERY_MAX_LENGTH) {
      res.status(400).json({ error: 'A valid content scope and search query are required.' });
      return;
    }
    const limit = req.query.limit === undefined ? undefined : Number(req.query.limit);
    if (limit !== undefined && (typeof req.query.limit !== 'string' || !Number.isInteger(limit) || limit < 1 || limit > 100)) {
      res.status(400).json({ error: 'Search limit must be between 1 and 100.' });
      return;
    }
    res.set('Cache-Control', 'no-store');
    try {
      const store = await resolveMetadataStore(metadataStoreResolver, req);
      if (!store.searchContent) { res.sendStatus(501); return; }
      res.json(await store.searchContent(scope, query, limit));
    } catch {
      res.sendStatus(500);
    }
  });

  return router;
}
