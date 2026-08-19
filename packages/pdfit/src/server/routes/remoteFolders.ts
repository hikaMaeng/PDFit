import { createReadStream } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import multer from 'multer';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { sanitizeName } from '../services/filesystem.js';
import type { FolderInfo, PdfInfo } from '../services/types.js';

/** Stream returned by a remote PDF content adapter. */
export interface PdfitRemoteFile extends PdfInfo {
  stream: NodeJS.ReadableStream;
  mimeType?: string;
}

/** Storage port used by the shared PDFit folder/file HTTP implementation. */
export interface PdfitRemoteLibraryAdapter {
  listFolders(request: Request, refresh: boolean): Promise<FolderInfo[]>;
  createFolder(request: Request, name: string): Promise<void>;
  updateFolderColor(request: Request, name: string, color: string): Promise<void>;
  renameFolder(request: Request, name: string, newName: string): Promise<void>;
  deleteFolder(request: Request, name: string): Promise<void>;
  listFiles(request: Request, folder: string): Promise<PdfInfo[]>;
  uploadFile(request: Request, folder: string, filename: string, body: NodeJS.ReadableStream): Promise<PdfInfo>;
  afterUpload?(request: Request): Promise<void>;
  getFile(request: Request, folder: string, filename: string): Promise<PdfInfo>;
  openFile(request: Request, folder: string, filename: string, range?: string): Promise<PdfitRemoteFile>;
  deleteFile(request: Request, folder: string, filename: string): Promise<void>;
  moveFile(request: Request, fromFolder: string, toFolder: string, filename: string): Promise<void>;
}

/** Runtime controls for the shared remote-library router. */
export interface PdfitRemoteFoldersRouterOptions {
  maxUploadBytes?: number;
  uploadMiddleware?: RequestHandler;
  sendError?: (response: Response, status: number, message: string, error: unknown) => void;
}

const DEFAULT_MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

/** Normalized single HTTP byte range. */
export interface ByteRange { start: number; end: number; header: string }

/** Parses one HTTP byte range using PDFit's canonical validation rules. */
export function parsePdfitByteRange(value: string | undefined, size: number): ByteRange | null {
  if (!value || !Number.isSafeInteger(size) || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return null;
    end = Math.min(end, size - 1);
  }
  return { start, end, header: `bytes=${start}-${end}` };
}

/** Creates PDFit's folder/file API over a remote content adapter such as Google Drive. */
export function createPdfitRemoteFoldersRouter(
  adapter: PdfitRemoteLibraryAdapter,
  options: PdfitRemoteFoldersRouterOptions = {},
): Router {
  const router = Router();
  const maxUploadBytes = options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  const upload = multer({ dest: tmpdir(), limits: { fileSize: maxUploadBytes, files: 5, fields: 10, parts: 15 } });
  const sendError = options.sendError ?? ((res, status, _message, error) => res.status(status).json({ error: String(error) }));

  router.get('/', async (req, res) => {
    try { res.json(await adapter.listFolders(req, false)); }
    catch (error) { sendError(res, 502, 'Library is temporarily unavailable.', error); }
  });
  router.post('/refresh', async (req, res) => {
    try { res.json(await adapter.listFolders(req, true)); }
    catch (error) { sendError(res, 502, 'Library refresh failed.', error); }
  });
  router.post('/', async (req, res) => {
    const name = sanitizeName(String(req.body?.name ?? '').trim());
    if (!name) { res.status(400).json({ error: 'Folder name is required.' }); return; }
    try { await adapter.createFolder(req, name); res.json({ name }); }
    catch (error) { sendError(res, 400, 'Folder could not be created.', error); }
  });
  router.patch('/:name/color', async (req, res) => {
    const color = String(req.body?.color ?? '');
    if (!/^#[0-9a-f]{6}$/i.test(color)) { res.status(400).json({ error: 'Invalid folder color.' }); return; }
    try { await adapter.updateFolderColor(req, sanitizeName(req.params.name), color.toLowerCase()); res.json({ ok: true }); }
    catch (error) { sendError(res, 400, 'Folder color could not be updated.', error); }
  });
  router.patch('/:name', async (req, res) => {
    const newName = sanitizeName(String(req.body?.newName ?? '').trim());
    if (!newName) { res.status(400).json({ error: 'New folder name is required.' }); return; }
    try { await adapter.renameFolder(req, sanitizeName(req.params.name), newName); res.json({ name: newName }); }
    catch (error) { sendError(res, 400, 'Folder could not be renamed.', error); }
  });
  router.delete('/:name', async (req, res) => {
    try { await adapter.deleteFolder(req, sanitizeName(req.params.name)); res.json({ ok: true }); }
    catch (error) { sendError(res, 400, 'Folder could not be deleted.', error); }
  });
  router.get('/:name/files', async (req, res) => {
    try { res.json(await adapter.listFiles(req, sanitizeName(req.params.name))); }
    catch (error) { sendError(res, 404, 'Folder was not found.', error); }
  });
  router.post('/:name/files', ...(options.uploadMiddleware ? [options.uploadMiddleware] : []), (req, res, next) => {
    upload.array('files')(req, res, (error) => {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: `File exceeds the ${Math.floor(maxUploadBytes / (1024 * 1024))} MB upload limit.` });
        return;
      }
      next(error);
    });
  }, async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const uploaded: PdfInfo[] = [];
    try {
      for (const file of files) {
        try {
          if (!file.originalname.toLowerCase().endsWith('.pdf')) continue;
          const handle = await open(file.path, 'r');
          const signature = Buffer.alloc(5);
          try { await handle.read(signature, 0, signature.length, 0); } finally { await handle.close(); }
          if (signature.toString('ascii') !== '%PDF-') continue;
          uploaded.push(await adapter.uploadFile(req, sanitizeName(req.params.name), sanitizeName(file.originalname), createReadStream(file.path)));
        } finally { await unlink(file.path).catch(() => undefined); }
      }
      await adapter.afterUpload?.(req);
      res.json(uploaded);
    } catch (error) {
      await Promise.all(files.map((file) => unlink(file.path).catch(() => undefined)));
      sendError(res, 502, 'File upload failed.', error);
    }
  });
  router.get('/:name/files/:filename', async (req, res) => {
    try {
      const folder = sanitizeName(req.params.name);
      const filename = sanitizeName(req.params.filename);
      const metadata = await adapter.getFile(req, folder, filename);
      const requestedRange = req.headers.range;
      const range = requestedRange ? parsePdfitByteRange(requestedRange, metadata.size) : null;
      if (requestedRange && !range) { res.status(416).setHeader('Content-Range', `bytes */${metadata.size}`).end(); return; }
      const file = await adapter.openFile(req, folder, filename, range?.header);
      res.setHeader('Content-Type', file.mimeType ?? 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Last-Modified', file.modifiedAt);
      if (range) res.status(206).setHeader('Content-Range', `bytes ${range.start}-${range.end}/${file.size}`).setHeader('Content-Length', String(range.end - range.start + 1));
      else res.setHeader('Content-Length', String(file.size));
      file.stream.pipe(res);
    } catch (error) { if (!res.headersSent) sendError(res, 404, 'File could not be loaded.', error); }
  });
  router.delete('/:name/files/:filename', async (req, res) => {
    try { await adapter.deleteFile(req, sanitizeName(req.params.name), sanitizeName(req.params.filename)); res.json({ ok: true }); }
    catch (error) { sendError(res, 400, 'File could not be deleted.', error); }
  });
  router.post('/move', async (req, res) => {
    const fromFolder = sanitizeName(String(req.body?.fromFolder ?? ''));
    const toFolder = sanitizeName(String(req.body?.toFolder ?? ''));
    const filename = sanitizeName(String(req.body?.filename ?? ''));
    if (!fromFolder || !toFolder || !filename) { res.status(400).json({ error: 'Required parameters are missing.' }); return; }
    try { await adapter.moveFile(req, fromFolder, toFolder, filename); res.json({ ok: true }); }
    catch (error) { sendError(res, 400, 'File could not be moved.', error); }
  });
  return router;
}
