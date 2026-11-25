import { Router, type Request, type Response } from 'express';
import type { OcrService } from '../ocr/ocrService.js';

/**
 * Page OCR for local library files.
 *   GET /page?folder&filename&pageIndex  ->  cached result or 204
 *   POST /page  { folder, filename, pageIndex }  ->  { text, source, cached, pageIndex, pageCount, durationMs }
 * `source` is `text-layer` (the PDF's own text), `vision` (AI server, for pages without
 * a text layer) or `none` (no text layer and no vision model configured).
 */
export function createOcrRouter(ocr: OcrService): Router {
  const router = Router();
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
    try {
      const result = cacheOnly
        ? await ocr.getCachedPage(folder, filename, pageIndex)
        : await ocr.recognizePage(folder, filename, pageIndex);
      if (result) res.json(result);
      else res.status(204).end();
    } catch (error) {
      const status = (error as { status?: number }).status;
      const message = error instanceof Error ? error.message : String(error);
      const code = status === 404 ? 404 : /outside 1\.\./.test(message) ? 400 : 502;
      // Without this line a failed read leaves only `ERROR POST /page 502` in the log,
      // which does not say whether the runtime or a gateway in front of it answered.
      if (code === 502) console.log(`[ocr] page ${pageIndex} of ${folder}/${filename} ${cacheOnly ? 'lookup' : 'scan'} failed: ${message}`);
      res.status(code).json({ error: message });
    }
  };
  router.get('/page', handlePage(true));
  router.post('/page', handlePage(false));
  return router;
}
