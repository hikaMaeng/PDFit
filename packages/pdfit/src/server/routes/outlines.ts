import { Router, type Request, type Response } from 'express';
import { sanitizeName } from '../services/filesystem.js';
import { resolveMetadataStore, type MetadataStoreResolver } from './metadataStoreResolver.js';
import { parseBookOutlineEntries, type BookOutlinePayload } from '../../common/protocol/outlines/index.js';

const DRIVE_FILE_ID = /^[A-Za-z0-9_-]{1,256}$/;

function driveFileId(req: Request): string | undefined {
  const value = typeof req.query.driveFileId === 'string' ? req.query.driveFileId : undefined;
  if (value && !DRIVE_FILE_ID.test(value)) throw new Error('Invalid Drive file ID.');
  return value;
}

/**
 * `/api/outlines/:folder/:filename`: the stored table of contents of one book.
 * GET returns `{ entries }` or 404. PUT replaces the outline, or initializes it when
 * If-None-Match is `*`. DELETE stores an empty outline to suppress automatic initialization.
 */
export function createOutlinesRouter(metadataStoreResolver: MetadataStoreResolver): Router {
  const router = Router();

  router.get('/:folder/:filename', async (req: Request, res: Response) => {
    try {
      const store = await resolveMetadataStore(metadataStoreResolver, req);
      if (!store.getBookOutline) { res.status(501).json({ error: 'Stored outlines are not supported.' }); return; }
      const entries = await store.getBookOutline(sanitizeName(req.params.folder), sanitizeName(req.params.filename), driveFileId(req));
      if (entries === null) { res.status(404).json({ error: 'No stored outline.' }); return; }
      const payload: BookOutlinePayload = { entries };
      res.set('Cache-Control', 'no-store').json(payload);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.put('/:folder/:filename', async (req: Request, res: Response) => {
    const entries = parseBookOutlineEntries((req.body as Partial<BookOutlinePayload> | undefined)?.entries);
    if (!entries) { res.status(400).json({ error: 'Invalid outline.' }); return; }
    try {
      const store = await resolveMetadataStore(metadataStoreResolver, req);
      const folder = sanitizeName(req.params.folder);
      const filename = sanitizeName(req.params.filename);
      const id = driveFileId(req);
      if (req.get('If-None-Match') === '*') {
        if (!store.initializeBookOutline) { res.status(501).json({ error: 'Outline initialization is not supported.' }); return; }
        const initialized = await store.initializeBookOutline(folder, filename, entries, id);
        if (!initialized) { res.status(412).json({ error: 'An outline is already stored.' }); return; }
      } else {
        if (!store.setBookOutline) { res.status(501).json({ error: 'Stored outlines are not supported.' }); return; }
        await store.setBookOutline(folder, filename, entries, id);
      }
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.delete('/:folder/:filename', async (req: Request, res: Response) => {
    try {
      const store = await resolveMetadataStore(metadataStoreResolver, req);
      if (!store.setBookOutline) { res.status(501).json({ error: 'Stored outlines are not supported.' }); return; }
      await store.setBookOutline(sanitizeName(req.params.folder), sanitizeName(req.params.filename), [], driveFileId(req));
      res.sendStatus(204);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
