import { Router, type Request, type Response } from 'express';
import type { MetadataStore } from '../../shared/index.js';
import { sanitizeName } from '../services/filesystem.js';

export function createProgressRouter(metadataStore: MetadataStore): Router {
  const router = Router();

  router.get('/:folder/:filename', async (req: Request, res: Response) => {
    try {
      const folder = sanitizeName(req.params.folder);
      const filename = sanitizeName(req.params.filename);
      res.json({ page: (await metadataStore.getProgress(folder, filename)) ?? 1 });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.put('/:folder/:filename', async (req: Request, res: Response) => {
    const { page } = req.body as { page?: number };
    if (!page || typeof page !== 'number' || page < 1) {
      res.status(400).json({ error: 'Invalid page.' });
      return;
    }

    try {
      const folder = sanitizeName(req.params.folder);
      const filename = sanitizeName(req.params.filename);
      await metadataStore.setProgress(folder, filename, page);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
