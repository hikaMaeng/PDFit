/**
 * Thumbnail task script. It follows the standard task contract (see
 * ../tasks/taskProtocol.ts): the default export's `run` receives one payload and
 * returns one result, inside a worker thread owned by the shared task pool.
 *
 * It renders page 1 of a PDF with PDF.js and writes a JPEG. PDF.js reads the source
 * in ranges, so a large PDF on a network share or behind an HTTP API costs about a
 * megabyte or two of I/O rather than the whole file.
 *
 * The source is either a local file (local runtime) or a URL with request headers
 * (hosted runtime: a storage API that honours `Range`, with its bearer token). The
 * script itself knows nothing about libraries, accounts, or where the JPEG goes next.
 */
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { threadId } from 'node:worker_threads';
import { defineTask } from '../tasks/taskProtocol.js';

export type ThumbnailTaskSource =
  | { kind: 'file'; path: string }
  | { kind: 'http'; url: string; headers?: Record<string, string> };

export interface ThumbnailTaskPayload {
  source: ThumbnailTaskSource;
  outputPath: string;
  width: number;
  quality: number;
}

export interface ThumbnailTaskResult {
  width: number;
  height: number;
  bytes: number;
  pages: number;
}

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
interface EncodableCanvas { width: number; height: number; encode(format: 'jpeg', quality: number): Promise<Buffer> }

const require = createRequire(import.meta.url);
// Loaded once per worker thread; the pool recycles the worker to bound PDF.js state.
let pdfJs: Promise<{ api: PdfJs; assetUrl: (directory: string) => string }> | undefined;

function loadPdfJs() {
  pdfJs ??= (async () => {
    const root = path.dirname(require.resolve('pdfjs-dist/package.json'));
    const api: PdfJs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    return { api, assetUrl: (directory: string) => pathToFileURL(path.join(root, directory) + path.sep).href };
  })();
  return pdfJs;
}

export default defineTask<ThumbnailTaskPayload, ThumbnailTaskResult>({
  async run(payload) {
    const { api, assetUrl } = await loadPdfJs();
    const { source } = payload;
    const loading = api.getDocument({
      url: source.kind === 'file' ? pathToFileURL(source.path).href : source.url,
      httpHeaders: source.kind === 'http' ? source.headers : undefined,
      disableAutoFetch: true,
      disableStream: true,
      rangeChunkSize: 256 * 1024,
      cMapUrl: assetUrl('cmaps'),
      standardFontDataUrl: assetUrl('standard_fonts'),
      wasmUrl: assetUrl('wasm'),
      iccUrl: assetUrl('iccs'),
      verbosity: 0,
    });
    try {
      const document = await loading.promise;
      const page = await document.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: payload.width / base.width });
      const { canvas, context } = (document as unknown as { canvasFactory: { create(width: number, height: number): { canvas: EncodableCanvas; context: unknown } } })
        .canvasFactory.create(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
      await page.render({ canvas: canvas as never, canvasContext: context as never, viewport, background: 'rgb(255,255,255)' }).promise;
      const jpeg = await canvas.encode('jpeg', payload.quality);

      // Write beside the target and rename, so a reader never sees a partial image.
      await fs.mkdir(path.dirname(payload.outputPath), { recursive: true });
      const temporaryPath = `${payload.outputPath}.${process.pid}-${threadId}.tmp`;
      await fs.writeFile(temporaryPath, jpeg);
      await fs.rename(temporaryPath, payload.outputPath);
      return { width: canvas.width, height: canvas.height, bytes: jpeg.length, pages: document.numPages };
    } finally {
      await loading.destroy().catch(() => undefined);
    }
  },
});
