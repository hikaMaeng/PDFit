import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { Router, type Request, type Response } from 'express';
import { sanitizeName } from '../services/filesystem.js';
import { LibraryOfflineError } from '../services/libraryVolume.js';
import type { FilesystemService } from '../services/types.js';
import type { BookRecord, MetadataStore } from '../../shared/index.js';
import type { CoverOverrideStore } from '../covers/coverOverrideStore.js';

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
  notifyChange?: (event: 'folders-changed' | 'tags-changed' | 'favorites-changed') => void,
  thumbnails?: FolderThumbnailProvider,
  /** Real-book covers chosen by the user; they replace the rendered first page. */
  covers?: CoverOverrideStore,
): Router {
  const router = Router();
  const upload = createUpload(filesystem, (req) => req.params.name, maxUploadBytes);

  // Folder names last seen on disk. Key: folder name; scope: this router (one library root);
  // bound: the number of directories directly under the root; replaced wholesale on every
  // successful read and kept as is while the volume is unreachable.
  let diskFolders: string[] = [];
  let diskFoldersReading = false;
  let diskFoldersCheckedAt = 0;
  const DISK_FOLDERS_MIN_INTERVAL_MS = 30_000;
  function refreshDiskFolders(): void {
    if (diskFoldersReading || Date.now() - diskFoldersCheckedAt < DISK_FOLDERS_MIN_INTERVAL_MS) return;
    diskFoldersReading = true;
    diskFoldersCheckedAt = Date.now();
    // The in-flight flag follows the real read, not the timeout, so a hung mount
    // holds at most one worker thread instead of one per attempt.
    const read = filesystem.listChildFolderNames();
    read.then((names) => { diskFolders = names; }, () => { /* volume unreachable: keep the last known list */ })
      .finally(() => { diskFoldersReading = false; });
  }

  /** A volume that is down is 503 (retry later); everything else keeps its own status. */
  const fail = (res: Response, error: unknown, status = 400) => {
    if (error instanceof LibraryOfflineError) { res.status(503).json({ error: String(error), code: error.code }); return; }
    res.status(status).json({ error: String(error) });
  };

  router.post('/refresh', async (_req: Request, res: Response) => {
    try {
      await refresh?.();
      res.json(await filesystem.listFolders());
    } catch (error) {
      fail(res, error, 500);
    }
  });

  router.get('/', async (_req: Request, res: Response) => {
    try {
      if (!listFolderBookCounts) {
        res.json(await filesystem.listFolders());
        return;
      }

      // The folder list is answered from the database alone, so it renders the
      // same whether or not the library volume (NAS) is reachable. A synchronous
      // directory read on a dead SMB mount blocks the whole server for 30s+.
      // Folders that exist on disk but hold no indexed PDF yet come from a cache
      // that is refreshed off the request path (see refreshDiskFolders).
      const [counts, colors] = await Promise.all([listFolderBookCounts(), listFolderColors?.() ?? Promise.resolve({} as Record<string, string>)]);
      refreshDiskFolders();
      const folders: Array<{ name: string; pdfCount: number; createdAt: string; isRoot: boolean; color: string }> = [
        { name: filesystem.rootFolderName, pdfCount: counts[filesystem.rootFolderName] ?? 0, createdAt: '', isRoot: true, color: '#3b82f6' },
      ];
      const known = new Set<string>(folders.map((folder) => folder.name));
      for (const [name, pdfCount] of Object.entries(counts)) {
        if (filesystem.isRootFolder(name) || known.has(name)) continue;
        known.add(name);
        folders.push({ name, pdfCount, createdAt: '', isRoot: false, color: '#3b82f6' });
      }
      for (const name of diskFolders) {
        if (known.has(name)) continue;
        known.add(name);
        folders.push({ name, pdfCount: 0, createdAt: '', isRoot: false, color: '#3b82f6' });
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

  router.post('/', async (req: Request, res: Response) => {
    const { name } = req.body as { name?: string };
    if (!name?.trim()) {
      res.status(400).json({ error: 'Folder name is required.' });
      return;
    }

    try {
      const safeName = sanitizeName(name.trim());
      await filesystem.createFolder(safeName);
      notifyChange?.('folders-changed');
      res.json({ name: safeName });
    } catch (error) {
      fail(res, error);
    }
  });

  router.patch('/:name', async (req: Request, res: Response) => {
    const { newName } = req.body as { newName?: string };
    if (!newName?.trim()) {
      res.status(400).json({ error: 'New folder name is required.' });
      return;
    }

    try {
      const safeName = sanitizeName(newName.trim());
      await filesystem.renameFolder(req.params.name, safeName);
      notifyChange?.('folders-changed');
      res.json({ name: safeName });
    } catch (error) {
      fail(res, error);
    }
  });

  router.delete('/:name', async (req: Request, res: Response) => {
    try {
      await filesystem.deleteFolder(req.params.name);
      await metadataMutation?.purgeFolder(req.params.name);
      notifyChange?.('folders-changed');
      notifyChange?.('tags-changed');
      notifyChange?.('favorites-changed');
      res.json({ ok: true });
    } catch (error) {
      fail(res, error);
    }
  });

  router.get('/:name/files', async (req: Request, res: Response) => {
    if (listBooks) {
      void listBooks(req.params.name).then((books) => res.json(books.map((book) => ({
        name: book.filename, size: book.size, modifiedAt: book.modified_at,
      })))).catch((error) => res.status(404).json({ error: String(error) }));
      return;
    }
    try { res.json(await filesystem.listPdfs(req.params.name)); }
    catch (error) { fail(res, error, 404); }
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
  //   A real-book cover the user chose wins over the rendered page. With `c` equal to
  //   its version the response is immutable; without it the client is revalidated.
  router.get('/:name/files/:filename/thumbnail', async (req: Request, res: Response) => {
    if (!thumbnails) { res.status(404).json({ error: 'Thumbnails are not enabled.' }); return; }
    const folder = decodeRouteParam(req.params.name);
    const filename = decodeRouteParam(req.params.filename);
    const override = covers ? await covers.get(folder, filename).catch(() => null) : null;
    if (override) {
      res.setHeader('Cache-Control', req.query.c === override.version ? 'public, max-age=31536000, immutable' : 'no-cache');
      res.type(override.type);
      res.sendFile(override.path, (error) => {
        if (error && !res.headersSent) res.status(404).json({ state: 'missing' });
      });
      return;
    }
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

  router.get('/:name/files/:filename', async (req: Request, res: Response) => {
    const folder = sanitizeName(decodeRouteParam(req.params.name));
    const filename = sanitizeName(decodeRouteParam(req.params.filename));
    const filePath = path.resolve(filesystem.getFolderPath(folder), filename);
    // Opening a book needs the volume. The guarded probe answers 503 at once while it is
    // down, so hung reads cannot pile up on the thread pool and starve database-backed routes.
    try { await filesystem.volume.run(() => fs.promises.stat(filePath)); }
    catch (error) { if (error instanceof LibraryOfflineError) { fail(res, error); return; } /* missing file: sendFile answers 404 below */ }
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
      await filesystem.deleteFile(folder, filename);
      await metadataMutation?.purgeFile(folder, filename);
      await covers?.remove(folder, filename).catch(() => false);
      notifyChange?.('folders-changed');
      notifyChange?.('tags-changed');
      notifyChange?.('favorites-changed');
      res.json({ ok: true });
    } catch (error) {
      fail(res, error);
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
      await filesystem.moveFile(fromFolder, toFolder, sanitizeName(filename));
      await covers?.move({ folder: fromFolder, filename: sanitizeName(filename) }, { folder: toFolder, filename: sanitizeName(filename) }).catch(() => false);
      await refresh?.();
      await metadataMutation?.purgeFile(fromFolder, sanitizeName(filename));
      notifyChange?.('folders-changed');
      notifyChange?.('tags-changed');
      notifyChange?.('favorites-changed');
      res.json({ ok: true });
    } catch (error) {
      fail(res, error);
    }
  });

  return router;
}
