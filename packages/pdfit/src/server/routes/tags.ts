import { Router, type Request, type Response } from 'express';
import { resolveMetadataStore, type MetadataStoreResolver } from './metadataStoreResolver.js';

export function createTagsRouter(metadataStoreResolver: MetadataStoreResolver): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    try {
      const metadataStore = await resolveMetadataStore(metadataStoreResolver, req);
      res.json(await metadataStore.listTags());
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/summary', async (req: Request, res: Response) => {
    try {
      const metadataStore = await resolveMetadataStore(metadataStoreResolver, req);
      res.json(await metadataStore.listTagSummaries());
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.delete('/:tag', async (req: Request, res: Response) => {
    try {
      const metadataStore = await resolveMetadataStore(metadataStoreResolver, req);
      await metadataStore.deleteTag(req.params.tag);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.patch('/:tag/color', async (req: Request, res: Response) => {
    const { color } = req.body as { color?: string };
    if (!color || !/^#[0-9a-f]{6}$/i.test(color)) {
      res.status(400).json({ error: 'A valid color is required.' }); return;
    }
    try {
      const metadataStore = await resolveMetadataStore(metadataStoreResolver, req);
      await metadataStore.updateTagColor(req.params.tag, color.toLowerCase());
      res.json({ ok: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  router.get('/:tag/books', async (req: Request, res: Response) => {
    try {
      const metadataStore = await resolveMetadataStore(metadataStoreResolver, req);
      res.json(await metadataStore.listBooksByTag(req.params.tag));
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/folder/:folder', async (req: Request, res: Response) => {
    try {
      const metadataStore = await resolveMetadataStore(metadataStoreResolver, req);
      res.json(await metadataStore.listFolderTags(req.params.folder));
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/book/:folder/:filename', async (req: Request, res: Response) => {
    try {
      const metadataStore = await resolveMetadataStore(metadataStoreResolver, req);
      res.json(await metadataStore.listBookTags(req.params.folder, req.params.filename));
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/book/:folder/:filename', async (req: Request, res: Response) => {
    const { tag } = req.body as { tag?: string };
    if (!tag?.trim()) {
      res.status(400).json({ error: 'Tag is required.' });
      return;
    }

    try {
      const metadataStore = await resolveMetadataStore(metadataStoreResolver, req);
      await metadataStore.addTag(req.params.folder, req.params.filename, tag.trim());
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.delete('/book/:folder/:filename/:tag', async (req: Request, res: Response) => {
    try {
      const metadataStore = await resolveMetadataStore(metadataStoreResolver, req);
      await metadataStore.removeTag(req.params.folder, req.params.filename, req.params.tag);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
