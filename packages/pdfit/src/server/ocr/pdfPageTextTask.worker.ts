/**
 * Page text task script (standard task contract, see ../tasks/taskProtocol.ts).
 *
 * Reads one page's PDF text layer with PDF.js, optionally only the items whose centre
 * lies inside a rectangle given in PDF page points with a top-left origin (the clip
 * bookmark coordinate space). When the area has no text layer and `render` is set, it
 * renders the same area to a JPEG for the vision model instead. Rendering is skipped
 * when text was found, so digital PDFs never pay for it.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { defineTask } from '../tasks/taskProtocol.js';

export interface PageTextRect { x: number; y: number; width: number; height: number }

export interface PageTextTaskPayload {
  sourcePath: string;
  /** 0-based page index. */
  pageIndex: number;
  /** Area in PDF points, top-left origin. Omit for the whole page. */
  rect?: PageTextRect;
  /** Render the area when it has no text: target width in pixels. */
  render?: { width: number; quality: number };
}

export interface PageTextTaskResult {
  text: string;
  /** Text items on the page, and how many fell inside the area. */
  itemCount: number;
  matchedItems: number;
  pageCount: number;
  pageWidth: number;
  pageHeight: number;
  /** Present only when the area had no text and `render` was requested. */
  image?: { jpegBase64: string; width: number; height: number };
}

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
interface EncodableCanvas { width: number; height: number; encode(format: 'jpeg', quality: number): Promise<Buffer> }
interface PositionedItem { str: string; x: number; top: number; baseline: number; width: number; height: number; hasEOL: boolean }

const require = createRequire(import.meta.url);
// Same loading as the thumbnail worker: once per worker thread.
let pdfJs: Promise<{ api: PdfJs; assetUrl: (directory: string) => string }> | undefined;
function loadPdfJs() {
  pdfJs ??= (async () => {
    const root = path.dirname(require.resolve('pdfjs-dist/package.json'));
    const api: PdfJs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    return { api, assetUrl: (directory: string) => pathToFileURL(path.join(root, directory) + path.sep).href };
  })();
  return pdfJs;
}

/** Text-layer characters that carry content (not whitespace). */
export function meaningfulLength(text: string): number {
  return text.replace(/\s+/g, '').length;
}

/**
 * Joins positioned text items into lines: a new line when an item ends a line or its
 * baseline moves by more than half its height, a space when the horizontal gap on a
 * line exceeds 15% of the height (so per-glyph CJK items stay joined).
 */
export function joinTextItems(items: PositionedItem[]): string {
  const lines: string[] = [];
  let line = '';
  let previous: PositionedItem | null = null;
  for (const item of items) {
    if (previous) {
      const height = Math.max(previous.height, item.height, 1);
      const newLine = previous.hasEOL || Math.abs(item.baseline - previous.baseline) > height * 0.5;
      if (newLine) {
        lines.push(line);
        line = '';
      } else {
        const gap = item.x - (previous.x + previous.width);
        if (gap > height * 0.15 && !line.endsWith(' ') && !item.str.startsWith(' ')) line += ' ';
      }
    }
    line += item.str;
    previous = item;
  }
  if (line || previous) lines.push(line);
  return lines.map((value) => value.replace(/[ \t]+/g, ' ').trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export default defineTask<PageTextTaskPayload, PageTextTaskResult>({
  async run(payload) {
    const { api, assetUrl } = await loadPdfJs();
    const loading = api.getDocument({
      url: pathToFileURL(payload.sourcePath).href,
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
      if (!Number.isInteger(payload.pageIndex) || payload.pageIndex < 0 || payload.pageIndex >= document.numPages) {
        throw new Error(`Page ${payload.pageIndex + 1} is outside 1..${document.numPages}.`);
      }
      const page = await document.getPage(payload.pageIndex + 1);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const rect = payload.rect;
      const positioned: PositionedItem[] = [];
      let itemCount = 0;
      for (const raw of content.items) {
        if (!('str' in raw)) continue;
        itemCount += 1;
        const [, , c, d, e, f] = api.Util.transform(viewport.transform, raw.transform) as number[];
        const height = Math.hypot(c, d) || raw.height || 1;
        const item: PositionedItem = { str: raw.str, x: e, baseline: f, top: f - height, width: raw.width, height, hasEOL: raw.hasEOL };
        if (rect) {
          const centreX = item.x + item.width / 2;
          const centreY = item.top + item.height / 2;
          if (centreX < rect.x || centreX > rect.x + rect.width || centreY < rect.y || centreY > rect.y + rect.height) continue;
        }
        positioned.push(item);
      }
      const text = joinTextItems(positioned);
      const result: PageTextTaskResult = { text, itemCount, matchedItems: positioned.length, pageCount: document.numPages, pageWidth: viewport.width, pageHeight: viewport.height };
      if (meaningfulLength(text) === 0 && payload.render) {
        const area = rect ?? { x: 0, y: 0, width: viewport.width, height: viewport.height };
        // At most 4x the PDF size: a small clip still reaches a readable resolution.
        const scale = Math.min(4, Math.max(0.1, payload.render.width / area.width));
        const renderViewport = page.getViewport({ scale, offsetX: -area.x * scale, offsetY: -area.y * scale });
        const width = Math.max(1, Math.ceil(area.width * scale));
        const height = Math.max(1, Math.ceil(area.height * scale));
        const { canvas, context } = (document as unknown as { canvasFactory: { create(width: number, height: number): { canvas: EncodableCanvas; context: unknown } } })
          .canvasFactory.create(width, height);
        await page.render({ canvas: canvas as never, canvasContext: context as never, viewport: renderViewport, background: 'rgb(255,255,255)' }).promise;
        const jpeg = await canvas.encode('jpeg', payload.render.quality);
        result.image = { jpegBase64: jpeg.toString('base64'), width, height };
      }
      return result;
    } finally {
      await loading.destroy().catch(() => undefined);
    }
  },
});
