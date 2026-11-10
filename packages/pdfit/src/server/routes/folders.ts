import path from 'node:path';
import multer from 'multer';
import { Router, type Request, type Response } from 'express';
import { sanitizeName } from '../services/filesystem.js';
import type { FilesystemService } from '../services/types.js';
import type { BookRecord, MetadataStore } from '../../shared/index.js';

type ReqWithParams = { params: Record<string, string> };

const DEFAULT_MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

function createUpload(
  filesystem: FilesystemService,
  getFolderName: (req: ReqWithParams) => string,
  maxUploadBytes: number,
) {
  return multer({
    storage: multer.diskStorage({
      destination: (req, _file, callback) => {
        const folder = sanitizeName(getFolderName(req as ReqWithParams));
        callback(null, filesystem.getFolderPath(folder));
      },
      filename: (_req, file, callback) => {
        const name = sanitizeName(Buffer.from(file.originalname, 'latin1').toString('utf8'));
        callback(null, name);
      },
    }),
    fileFilter: (_req, file, callback) => {
      callback(null, path.extname(file.originalname).toLowerCase() === '.pdf');
    },
    limits: { fileSize: maxUploadBytes },
  });
}

function decodeRouteParam(value: string): string {
  let decoded = value;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return decoded;
      decoded = next;
    } catch {
      return decoded;
    }
  }
  return decoded;
}

/** Server-generated first-page thumbnails for local library files. */
export interface FolderThumbnailProvider {
  /** Path of the thumbnail for a source stamp the client supplied, or null. Must not touch the library. */
  find(folder: string, filename: string, stamp: string): Promise<string | null>;
  /** Current thumbnail of the file, or what is happening instead. May queue generation. */
  resolve(folder: string, filename: string): Promise<{ state: 'ready'; path: string } | { state: 'queued' | 'failed' | 'missing' }>;
}

const THUMBNAIL_STAMP_PATTERN = /^\d{1,16}-\d{1,16}$/;

export function createFoldersRouter(
  filesystem: FilesystemService,
  refresh?: () => Promise<void>,
  listBooks?: (folder: string) => Promise<BookRecord[]>,
  listFolderBookCounts?: () => Promise<Record<string, number>>,
  listFolderColors?: () => Promise<Record<string, string>>,
  updateFolderColor?: (folder: string, color: string) => Promise<void>,
  metadataMutation?: Pick<MetadataStore, 'purgeFile' | 'purgeFolder'>,
  maxUploadBytes = DEFAULT_MAX_UPLOAD_BYTES,
  notifyChange?: (event: 'folders-changed' | 'tags-changed') => void,
  thumbnails?: FolderThumbnailProvider,
): Router {
  const router = Router();
  const upload = createUpload(filesystem, (req) => req.params.name, maxUploadBytes);

  router.post('/refresh', async (_req: Request, res: Response) => {
    try {
      await refresh?.();
      res.json(filesystem.listFolders());
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/', async (_req: Request, res: Response) => {
    try {
      if (!listFolderBookCounts) {
        res.json(filesystem.listFolders());
        return;
      }

      // Folder discovery must not scan/stat every PDF on the library volume.
      // Both folder names and counts come from the indexed metadata table.
      // The filesystem is reserved for the explicit refresh operation.
      const counts = await listFolderBookCounts();
      const folders = filesystem.listFolderShells();
      const root = folders[0];
      const colors = await listFolderColors?.() ?? {};
      const indexedFolders = Object.entries(counts)
        .filter(([name]) => !filesystem.isRootFolder(name))
        .map(([name, pdfCount]) => ({ name, pdfCount, createdAt: '', isRoot: false, color: colors[name] ?? '#3b82f6' }));
      root.pdfCount = counts[root.name] ?? 0;
      const indexedByName = new Map(indexedFolders.map((folder) => [folder.name, folder]));
      for (const folder of folders) {
        const indexed = indexedByName.get(folder.name);
        if (indexed) {
          folder.pdfCount = indexed.pdfCount;
          folder.createdAt = indexed.createdAt;
        }
      }
      for (const folder of indexedFolders) {
        if (!folders.some((existing) => existing.name === folder.name)) folders.push(folder);
      }
      folders.sort((left, right) => {
        if (left.isRoot) return -1;
        if (right.isRoot) return 1;
        return left.name.localeCompare(right.name, 'ko');
      });
      res.json(folders.map((folder) => ({ ...folder, color: colors[folder.name] ?? '#3b82f6' })));
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.patch('/:name/color', async (req: Request, res: Response) => {
    const { color } = req.body as { color?: string };
    if (!/^#[0-9a-f]{6}$/i.test(color ?? '')) { res.status(400).json({ error: 'Invalid folder color.' }); return; }
    try { await updateFolderColor?.(req.params.name, color!.toLowerCase()); notifyChange?.('folders-changed'); res.json({ ok: true }); }
    catch (error) { res.status(400).json({ error: String(error) }); }
  });

  router.post('/', (req: Request, res: Response) => {
    const { name } = req.body as { name?: string };
    if (!name?.trim()) {
      res.status(400).json({ error: 'Folder name is required.' });
      return;
    }

    try {
      const safeName = sanitizeName(name.trim());
      filesystem.createFolder(safeName);
      notifyChange?.('folders-changed');
      res.json({ name: safeName });
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });

  router.patch('/:name', (req: Request, res: Response) => {
    const { newName } = req.body as { newName?: string };
    if (!newName?.trim()) {
      res.status(400).json({ error: 'New folder name is required.' });
      return;
    }

    try {
      const safeName = sanitizeName(newName.trim());
      filesystem.renameFolder(req.params.name, safeName);
      notifyChange?.('folders-changed');
      res.json({ name: safeName });
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });

  router.delete('/:name', async (req: Request, res: Response) => {
    try {
      filesystem.deleteFolder(req.params.name);
      await metadataMutation?.purgeFolder(req.params.name);
      notifyChange?.('folders-changed');
      notifyChange?.('tags-changed');
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });

  router.get('/:name/files', (req: Request, res: Response) => {
    if (listBooks) {
      void listBooks(req.params.name).then((books) => res.json(books.map((book) => ({
        name: book.filename, size: book.size, modifiedAt: book.modified_at,
      })))).catch((error) => res.status(404).json({ error: String(error) }));
      return;
    }
    try { res.json(filesystem.listPdfs(req.params.name)); }
    catch (error) { res.status(404).json({ error: String(error) }); }
  });

  router.post(
    '/:name/files',
    (req: Request, res: Response, next) => {
      upload.array('files')(req as Request, res as Response, (error) => {
        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
          const limitMb = Math.floor(maxUploadBytes / (1024 * 1024));
          res.status(413).json({ error: `파일당 최대 업로드 용량은 ${limitMb}MB입니다.` });
          return;
        }
        next(error);
      });
    },
    async (req: Request, res: Response) => {
      const files = (req.files as Express.Multer.File[]) ?? [];
      if (files.length === 0) {
        res.status(400).json({ error: 'No PDF files selected.' });
        return;
      }
      try {
        await refresh?.();
        notifyChange?.('folders-changed');
        res.json(files.map((file) => ({ name: file.filename, size: file.size })));
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    },
  );

  // First-page thumbnail produced by the background thumbnail task.
  //   200 image/jpeg       the thumbnail (immutable when `v` matched, revalidated otherwise)
  //   202 {state:'queued'} not rendered yet; this request moved it to the front of the queue
  //   404 {state}          `failed` (rendering failed recently) or `missing` (no such PDF)
  router.get('/:name/files/:filename/thumbnail', async (req: Request, res: Response) => {
    if (!thumbnails) { res.status(404).json({ error: 'Thumbnails are not enabled.' }); return; }
    const folder = decodeRouteParam(req.params.name);
    const filename = decodeRouteParam(req.params.filename);
    const stamp = typeof req.query.v === 'string' && THUMBNAIL_STAMP_PATTERN.test(req.query.v) ? req.query.v : null;
    const send = (filePath: string, cacheControl: string) => {
      res.setHeader('Cache-Control', cacheControl);
      res.type('image/jpeg');
      res.sendFile(filePath, (error) => {
        if (error && !res.headersSent) res.status(404).json({ state: 'missing' });
      });
    };
    try {
      // `v` is the source's modification time and size as the client knows them. A hit
      // needs no access to the library volume and can be cached for good under that URL.
      const known = stamp ? await thumbnails.find(folder, filename, stamp) : null;
      if (known) { send(known, 'public, max-age=31536000, immutable'); return; }
      const current = await thumbnails.resolve(folder, filename);
      if (current.state === 'ready') { send(current.path, 'no-cache'); return; }
      res.setHeader('Cache-Control', 'no-store');
      res.status(current.state === 'queued' ? 202 : 404).json({ state: current.state });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/:name/files/:filename', (req: Request, res: Response) => {
    const folder = sanitizeName(decodeRouteParam(req.params.name));
    const filename = sanitizeName(decodeRouteParam(req.params.filename));
    const filePath = path.resolve(filesystem.getFolderPath(folder), filename);
    if (req.query.download === '1') {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.download(filePath, filename, (error) => {
        if (error && !res.headersSent) res.status(404).json({ error: 'File not found.' });
      });
      return;
    }
    res.sendFile(filePath, (error) => {
      // A client that aborts a range read (PDF.js cancelling an off-screen cover,
      // or a closed tab) reports an error after headers were sent. Responding
      // again would throw ERR_HTTP_HEADERS_SENT outside any handler and crash
      // the whole server process.
      if (error && !res.headersSent) {
        res.status(404).json({ error: 'File not found.' });
      }
    });
  });

  router.delete('/:name/files/:filename', async (req: Request, res: Response) => {
    try {
      const folder = decodeRouteParam(req.params.name);
      const filename = sanitizeName(decodeRouteParam(req.params.filename));
      filesystem.deleteFile(folder, filename);
      await metadataMutation?.purgeFile(folder, filename);
      notifyChange?.('folders-changed');
      notifyChange?.('tags-changed');
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });

  router.post('/move', async (req: Request, res: Response) => {
    const { fromFolder, toFolder, filename } = req.body as {
      fromFolder?: string;
      toFolder?: string;
      filename?: string;
    };

    if (!fromFolder || !toFolder || !filename) {
      res.status(400).json({ error: 'Required parameters are missing.' });
      return;
    }

    try {
      filesystem.moveFile(fromFolder, toFolder, sanitizeName(filename));
      await refresh?.();
      await metadataMutation?.purgeFile(fromFolder, sanitizeName(filename));
      notifyChange?.('folders-changed');
      notifyChange?.('tags-changed');
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });

  return router;
}
