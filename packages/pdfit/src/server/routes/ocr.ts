import { Router, type Request, type Response } from 'express';
import type { OcrService } from '../ocr/ocrService.js';

/**
 * Page OCR for local library files.
 *   POST /page  { folder, filename, pageIndex }  ->  { text, source, cached, pageIndex, pageCount, durationMs }
 * `source` is `text-layer` (the PDF's own text), `vision` (AI server, for pages without
 * a text layer) or `none` (no text layer and no vision model configured).
 */
export function createOcrRouter(ocr: OcrService): Router {
  const router = Router();
  router.post('/page', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const folder = typeof body.folder === 'string' ? body.folder : null;
    const filename = typeof body.filename === 'string' && body.filename && body.filename.length <= 500 ? body.filename : null;
    const pageIndex = typeof body.pageIndex === 'number' && Number.isInteger(body.pageIndex) && body.pageIndex >= 0 ? body.pageIndex : null;
    if (folder === null || !filename || pageIndex === null) { res.status(400).json({ error: 'folder, filename and a 0-based integer pageIndex are required.' }); return; }
    try {
      res.json(await ocr.recognizePage(folder, filename, pageIndex));
    } catch (error) {
      const status = (error as { status?: number }).status;
      const message = error instanceof Error ? error.message : String(error);
      res.status(status === 404 ? 404 : /outside 1\.\./.test(message) ? 400 : 502).json({ error: message });
    }
  });
  return router;
}
