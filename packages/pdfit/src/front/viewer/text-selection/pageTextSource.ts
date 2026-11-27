import type { PdfRasterProvider } from '@pdfgpu/core';
import type { PDFDocumentLoadingTask, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { isUntrustedTextLayer } from '../../../common/ocr/textLayerQuality.js';
import { loadPdfJs, type PdfJsModule } from '../../pdfjs.js';
import type { PageTextRun, SelectablePageText } from './pageTextModel.js';
import type { SelectionOcr } from './ocr.js';

const OCR_DPI = 150;
const OCR_MAX_EDGE = 2400;

async function readPdfText(pdfjs: PdfJsModule, page: PDFPageProxy, signal: AbortSignal): Promise<SelectablePageText & { untrusted: boolean }> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  signal.throwIfAborted();
  const runs: PageTextRun[] = [];
  let before: PageTextRun['before'];
  for (const item of content.items) {
    if (!('str' in item)) continue;
    if (!item.str.trim()) {
      if (item.hasEOL) before = '\n';
      else if (item.str && before !== '\n') before = ' ';
      continue;
    }
    const [a, b, c, d, e, f] = pdfjs.Util.transform(viewport.transform, item.transform) as number[];
    const style = content.styles[item.fontName];
    const angle = Math.atan2(b, a) + (style?.vertical ? Math.PI / 2 : 0);
    const height = Math.hypot(c, d);
    const ascent = height * (style?.ascent || (style?.descent ? 1 + style.descent : 0.8));
    const width = (style?.vertical ? item.height : item.width) * Math.hypot(viewport.transform[0], viewport.transform[1]);
    if (height <= 0 || width <= 0) continue;
    const previous = runs.at(-1);
    if (previous && !before && Math.abs(angle) < 0.05 && Math.abs(previous.y - (f - ascent)) > height * 0.65) before = '\n';
    runs.push({ text: item.str, before, x: e + ascent * Math.sin(angle), y: f - ascent * Math.cos(angle), width, height,
      angle, direction: item.dir });
    before = item.hasEOL ? '\n' : undefined;
  }

  const layerText = runs.map((run) => (run.before ?? '') + run.text).join('');
  let untrusted = !/[\p{L}\p{N}]/u.test(layerText);
  if (!untrusted && isUntrustedTextLayer('hidden', layerText)) {
    const operators = await page.getOperatorList();
    // Mixed pages can legitimately contain invisible text and visible text together.
    let hidden = false;
    let visibleText = false;
    let hiddenText = false;
    for (let index = 0; index < operators.fnArray.length; index += 1) {
      const op = operators.fnArray[index];
      if (op === pdfjs.OPS.setTextRenderingMode) hidden = operators.argsArray[index][0] === 3;
      if (op === pdfjs.OPS.showText) {
        if (hidden) hiddenText = true;
        else visibleText = true;
      }
    }
    untrusted = hiddenText && !visibleText;
  }
  return { source: 'pdf', width: viewport.width, height: viewport.height, runs, untrusted };
}

export class PageTextSource {
  private document?: PDFDocumentLoadingTask;
  private ocr?: SelectionOcr;
  private disposed = false;

  constructor(private readonly url: string, private readonly provider: PdfRasterProvider) {}

  read = async (pageIndex: number, signal: AbortSignal): Promise<SelectablePageText> => {
    let native: Awaited<ReturnType<typeof readPdfText>> | undefined;
    try {
      const pdfjs = await loadPdfJs();
      signal.throwIfAborted();
      if (this.disposed) throw new DOMException('Document closed', 'AbortError');
      const task = this.document ??= pdfjs.getDocument({ url: this.url, disableStream: true, disableAutoFetch: true });
      const page = await (await task.promise).getPage(pageIndex + 1);
      native = await readPdfText(pdfjs, page, signal);
      if (!native.untrusted) return native;
    } catch {
      signal.throwIfAborted();
    }

    try {
      const { SelectionOcr } = await import('./ocr.js');
      signal.throwIfAborted();
      const ocr = this.ocr ??= new SelectionOcr();
      const dpi = native ? Math.min(OCR_DPI, Math.max(1, Math.floor(OCR_MAX_EDGE * 72 / Math.max(native.width, native.height)))) : OCR_DPI;
      const raster = await this.provider.renderPreview({ pageIndex, dpi, signal });
      const canvas = document.createElement('canvas');
      try {
        signal.throwIfAborted();
        canvas.width = raster.width;
        canvas.height = raster.height;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) throw new Error('OCR canvas unavailable');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(raster.source, 0, 0);
        const width = native?.width ?? raster.width * 72 / raster.dpi;
        const height = native?.height ?? raster.height * 72 / raster.dpi;
        const runs = await ocr.read(canvas, width, height, signal);
        return runs.length || !native ? { source: 'ocr', width, height, runs } : native;
      } finally {
        if (raster.source instanceof ImageBitmap) raster.source.close();
        canvas.width = canvas.height = 0;
      }
    } catch (error) {
      signal.throwIfAborted();
      if (native?.runs.length) return native;
      throw error;
    }
  };

  dispose() {
    this.disposed = true;
    this.ocr?.dispose();
    void this.document?.destroy().catch(() => {});
  }
}
