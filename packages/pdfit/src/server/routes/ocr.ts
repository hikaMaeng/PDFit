import { Router, type Request, type Response } from 'express';
import type { OcrService } from '../ocr/ocrService.js';
import { createAiProgressResponse } from '../services/aiProgressResponse.js';

function scanBook(input: Record<string, unknown>) {
  const { folder, filename } = input;
  if (typeof folder !== 'string' || folder === '.' || folder === '..' || /[/\\\0]/.test(folder)
    || typeof filename !== 'string' || filename.length > 500 || /[/\\\0]/.test(filename)
    || !filename.toLowerCase().endsWith('.pdf')) return null;
  return { folder, filename };
}

/**
 * Page OCR for local library files.
 *   GET /page?folder&filename&pageIndex  ->  cached result or 204
 *   POST /page  { folder, filename, pageIndex }  ->  { text, source, cached, pageIndex, pageCount, durationMs }
 * `source` is `text-layer` (the PDF's own text), `vision` (AI server, for pages without
 * a text layer) or `none` (no text layer and no vision model configured).
 */
export function createOcrRouter(ocr: OcrService): Router {
  const router = Router();
  const scan = ocr.scan;
  // see packages/pdfit/docs/api.md#document-scan
  if (scan) {
    router.get('/scan', (req, res) => {
      const book = scanBook(req.query);
      if (!book) { res.status(400).json({ error: 'A PDF folder and filename are required.' }); return; }
      res.set('Cache-Control', 'no-store').json({ job: scan.get(book.folder, book.filename) });
    });
    router.get('/scan/pages', async (req, res) => {
      const book = scanBook(req.query);
      if (!book) { res.status(400).json({ error: 'A PDF folder and filename are required.' }); return; }
      try {
        const pages = await scan.listPages(book.folder, book.filename);
        res.set('Cache-Control', 'no-store').json({ pages });
      } catch (error) {
        const code = (error as { status?: number }).status === 404 ? 404 : 500;
        res.status(code).json({ error: 'Could not load page OCR status.' });
      }
    });
    router.post('/scan', (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const book = scanBook(body);
      const startPage = body.startPage;
      if (!book || typeof startPage !== 'number' || !Number.isSafeInteger(startPage) || startPage < 1) {
        res.status(400).json({ error: 'A PDF folder, filename and 1-based start page are required.' });
        return;
      }
      res.status(202).json({ job: scan.start(book.folder, book.filename, startPage) });
    });
    router.post('/scan/cancel', (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const book = scanBook(body);
      if (!book || typeof body.id !== 'string') { res.status(400).json({ error: 'A PDF folder, filename and scan ID are required.' }); return; }
      res.json({ job: scan.cancel(book.folder, book.filename, body.id) });
    });
  }
  // see packages/pdfit/docs/api.md#ocr-local-runtime
  const handlePage = (cacheOnly: boolean) => async (req: Request, res: Response) => {
    const input = (cacheOnly ? req.query : req.body ?? {}) as Record<string, unknown>;
    const folder = typeof input.folder === 'string' ? input.folder : null;
    const filename = typeof input.filename === 'string' && input.filename && input.filename.length <= 500 ? input.filename : null;
    const pageIndex = cacheOnly && typeof input.pageIndex === 'string' && /^\d+$/.test(input.pageIndex)
      ? Number(input.pageIndex)
      : input.pageIndex;
    if (cacheOnly) res.set('Cache-Control', 'no-store');
    if (folder === null || !filename || typeof pageIndex !== 'number' || !Number.isSafeInteger(pageIndex) || pageIndex < 0) {
      res.status(400).json({ error: 'folder, filename and a 0-based integer pageIndex are required.' });
      return;
    }
    const progress = createAiProgressResponse(req, res);
    try {
      const result = cacheOnly
        ? await ocr.getCachedPage(folder, filename, pageIndex)
        : await ocr.recognizePage(folder, filename, pageIndex, progress.report);
      if (result) progress.send(200, result);
      else res.status(204).end();
    } catch (error) {
      const status = (error as { status?: number }).status;
      const message = error instanceof Error ? error.message : String(error);
      const code = status === 404 ? 404 : /outside 1\.\./.test(message) ? 400 : 502;
      // Without this line a failed read leaves only `ERROR POST /page 502` in the log,
      // which does not say whether the runtime or a gateway in front of it answered.
      if (code === 502) console.log(`[ocr] page ${pageIndex} of ${folder}/${filename} ${cacheOnly ? 'lookup' : 'scan'} failed: ${message}`);
      progress.send(code, { error: message });
    }
  };
  router.get('/page', handlePage(true));
  router.post('/page', handlePage(false));
  router.put('/page', async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const book = scanBook(body);
    const { pageIndex, revision, text } = body;
    if (!book || typeof pageIndex !== 'number' || !Number.isSafeInteger(pageIndex) || pageIndex < 0
      || typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)
      || typeof text !== 'string' || text.length > 1_000_000 || text.includes('\0')) {
      res.status(400).json({ error: 'A PDF, page index, current revision and valid page text are required.' });
      return;
    }
    try {
      res.set('Cache-Control', 'no-store').json(await ocr.savePageText(book.folder, book.filename, pageIndex, revision, text));
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 404 || status === 409) {
        res.status(status).json({ error: status === 409 ? 'The saved page text has changed.' : 'File not found.' });
        return;
      }
      console.error('[ocr] Could not save page text:', error);
      res.status(500).json({ error: 'Could not save page text.' });
    }
  });
  return router;
}
