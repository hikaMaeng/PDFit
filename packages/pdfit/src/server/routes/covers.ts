import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import { sanitizeName } from '../services/filesystem.js';
import type { FilesystemService } from '../services/types.js';
import type { CoverOverrideStore } from '../covers/coverOverrideStore.js';
import { downloadCoverImage, findBookCoverCandidates, isAllowedCoverImageUrl, type BookCoverSource } from '../covers/coverSources.js';

export interface CoversRouterOptions {
  filesystem: FilesystemService;
  store: CoverOverrideStore;
  notifyChange?: (event: 'folders-changed') => void;
  /** Injected for tests; defaults to the global fetch. */
  request?: typeof fetch;
}

const SOURCES = new Set<BookCoverSource>(['YES24', 'Open Library']);

function textParam(value: unknown, max = 500): string | null {
  return typeof value === 'string' && value.trim() && value.length <= max ? value : null;
}

/**
 * Real-book covers for local library files.
 *   GET    /                       every replaced cover: [{ folder, filename, version, source, title }]
 *   GET    /candidates?q=          candidates from YES24 and Open Library, best title match first
 *   GET    /preview?url=           a candidate image through the server (allowed hosts only)
 *   PUT    /   {folder, filename, imageUrl, source, title, pageUrl?}   download and apply
 *   DELETE /?folder=&filename=     restore the rendered first page
 */
export function createCoversRouter(options: CoversRouterOptions): Router {
  const router = Router();
  const { filesystem, store } = options;
  const request = options.request ?? fetch;

  const fileExists = (folder: string, filename: string) => {
    try {
      const filePath = path.resolve(filesystem.getFolderPath(sanitizeName(folder)), sanitizeName(filename));
      return fs.statSync(filePath).isFile();
    } catch {
      return false;
    }
  };

  router.get('/', async (_req: Request, res: Response) => {
    try {
      const records = await store.list();
      res.json({ overrides: records.map(({ folder, filename, version, source, title }) => ({ folder, filename, version, source, title })) });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/candidates', async (req: Request, res: Response) => {
    const query = textParam(req.query.q, 200);
    if (!query) { res.status(400).json({ error: 'q is required (at most 200 characters).' }); return; }
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await findBookCoverCandidates(query, { request }));
    } catch (error) {
      res.status(502).json({ error: String(error) });
    }
  });

  router.get('/preview', async (req: Request, res: Response) => {
    const url = textParam(req.query.url, 500);
    if (!url || !isAllowedCoverImageUrl(url)) { res.status(400).json({ error: 'url must be a cover image from an allowed host.' }); return; }
    try {
      const image = await downloadCoverImage(url, { request });
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.type(image.type).send(image.bytes);
    } catch (error) {
      res.status(502).json({ error: String(error) });
    }
  });

  router.put('/', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const folder = typeof body.folder === 'string' ? body.folder : null;
    const filename = textParam(body.filename);
    const imageUrl = textParam(body.imageUrl);
    const title = textParam(body.title, 300) ?? '';
    const pageUrl = textParam(body.pageUrl) ?? undefined;
    const source = typeof body.source === 'string' && SOURCES.has(body.source as BookCoverSource) ? body.source as BookCoverSource : null;
    if (folder === null || !filename || !imageUrl || !source) { res.status(400).json({ error: 'folder, filename, imageUrl and source are required.' }); return; }
    if (!isAllowedCoverImageUrl(imageUrl)) { res.status(400).json({ error: 'imageUrl must be a cover image from an allowed host.' }); return; }
    if (!fileExists(folder, filename)) { res.status(404).json({ error: 'File not found.' }); return; }
    try {
      const image = await downloadCoverImage(imageUrl, { request });
      const record = await store.set(folder, sanitizeName(filename), image, { source, title, imageUrl, pageUrl });
      options.notifyChange?.('folders-changed');
      res.json({ folder: record.folder, filename: record.filename, version: record.version, source: record.source, title: record.title });
    } catch (error) {
      res.status(502).json({ error: String(error) });
    }
  });

  router.delete('/', async (req: Request, res: Response) => {
    const folder = typeof req.query.folder === 'string' ? req.query.folder : null;
    const filename = textParam(req.query.filename);
    if (folder === null || !filename) { res.status(400).json({ error: 'folder and filename are required.' }); return; }
    try {
      const removed = await store.remove(folder, sanitizeName(filename));
      if (removed) options.notifyChange?.('folders-changed');
      res.json({ removed });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
