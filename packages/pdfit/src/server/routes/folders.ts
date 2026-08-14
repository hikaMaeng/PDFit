import path from 'node:path';
import multer from 'multer';
import { Router, type Request, type Response } from 'express';
import { sanitizeName } from '../services/filesystem.js';
import type { FilesystemService } from '../services/types.js';
import type { BookRecord } from '../../shared/index.js';

type ReqWithParams = { params: Record<string, string> };

function createUpload(filesystem: FilesystemService, getFolderName: (req: ReqWithParams) => string) {
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
    limits: { fileSize: 200 * 1024 * 1024 },
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

export function createFoldersRouter(
  filesystem: FilesystemService,
  refresh?: () => Promise<void>,
  listBooks?: (folder: string) => Promise<BookRecord[]>,
  listFolderBookCounts?: () => Promise<Record<string, number>>,
  listFolderColors?: () => Promise<Record<string, string>>,
  updateFolderColor?: (folder: string, color: string) => Promise<void>,
): Router {
  const router = Router();
  const upload = createUpload(filesystem, (req) => req.params.name);

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
    try { await updateFolderColor?.(req.params.name, color!.toLowerCase()); res.json({ ok: true }); }
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
      res.json({ name: safeName });
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });

  router.delete('/:name', (req: Request, res: Response) => {
    try {
      filesystem.deleteFolder(req.params.name);
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
      upload.array('files')(req as Request, res as Response, next);
    },
    (req: Request, res: Response) => {
      const files = (req.files as Express.Multer.File[]) ?? [];
      if (files.length === 0) {
        res.status(400).json({ error: 'No PDF files selected.' });
        return;
      }
      res.json(files.map((file) => ({ name: file.filename, size: file.size })));
    },
  );

  router.get('/:name/files/:filename', (req: Request, res: Response) => {
    const folder = sanitizeName(decodeRouteParam(req.params.name));
    const filename = sanitizeName(decodeRouteParam(req.params.filename));
    const filePath = path.resolve(filesystem.getFolderPath(folder), filename);
    res.sendFile(filePath, (error) => {
      if (error) {
        res.status(404).json({ error: 'File not found.' });
      }
    });
  });

  router.delete('/:name/files/:filename', (req: Request, res: Response) => {
    try {
      filesystem.deleteFile(decodeRouteParam(req.params.name), sanitizeName(decodeRouteParam(req.params.filename)));
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });

  router.post('/move', (req: Request, res: Response) => {
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
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });

  return router;
}
