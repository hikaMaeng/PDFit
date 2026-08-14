import { Router, type Request, type Response } from 'express';
import type { MetadataStore } from '../../shared/index.js';
import { sanitizeName } from '../services/filesystem.js';

export function createViewerStateRouter(metadataStore: MetadataStore): Router {
  const router = Router();

  router.get('/:folder/:filename', async (req: Request, res: Response) => {
    try {
      const folder = sanitizeName(req.params.folder);
      const filename = sanitizeName(req.params.filename);
      res.json(await metadataStore.getViewerState(folder, filename));
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.put('/:folder/:filename', async (req: Request, res: Response) => {
    const { page, scale, fitMode, viewMode, inverted, uiHidden, scrollTop } = req.body as {
      page?: number;
      scale?: number;
      fitMode?: string;
      viewMode?: string;
      inverted?: boolean;
      uiHidden?: boolean;
      scrollTop?: number;
    };

    if (typeof page !== 'number' || page < 1) {
      res.status(400).json({ error: 'Invalid page.' });
      return;
    }
    if (typeof scale !== 'number' || scale <= 0) {
      res.status(400).json({ error: 'Invalid scale.' });
      return;
    }
    if (!fitMode || !viewMode) {
      res.status(400).json({ error: 'Invalid view mode.' });
      return;
    }

    try {
      const folder = sanitizeName(req.params.folder);
      const filename = sanitizeName(req.params.filename);
      await metadataStore.setViewerState(folder, filename, {
        page,
        scale,
        fitMode,
        viewMode,
        inverted: Boolean(inverted),
        uiHidden: Boolean(uiHidden),
        scrollTop: scrollTop ?? 0,
      });
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
