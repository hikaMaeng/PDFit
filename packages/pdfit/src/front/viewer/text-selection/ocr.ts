import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import workerPath from 'tesseract.js/dist/worker.min.js?url&no-inline';
import corePath from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url&no-inline';
import { VIEWER_OCR_MODELS_PATH } from '../../../common/ocr/modelAssets.js';
import type { PageTextRun } from './pageTextModel.js';

/** Reuse the loaded worker across pages of this document. */
export class SelectionOcr {
  private worker?: Promise<Worker>;
  private readonly lifetime = new AbortController();

  async read(canvas: HTMLCanvasElement, pageWidth: number, pageHeight: number, signal: AbortSignal) {
    const worker = await (this.worker ??= this.create().catch((error) => {
      this.worker = undefined;
      throw error;
    }));
    signal.throwIfAborted();
    const { data } = await this.untilClosed(() => worker.recognize(canvas, {}, { blocks: true }));
    signal.throwIfAborted();
    const scaleX = pageWidth / canvas.width;
    const scaleY = pageHeight / canvas.height;
    const runs: PageTextRun[] = [];
    for (const block of data.blocks ?? []) {
      for (const paragraph of block.paragraphs) {
        for (const line of paragraph.lines) {
          let before: PageTextRun['before'] = runs.length ? '\n' : undefined;
          for (const word of line.words) {
            const { x0, y0, x1, y1 } = word.bbox;
            if (!word.text.trim() || x1 <= x0 || y1 <= y0) continue;
            runs.push({ text: word.text, before, x: x0 * scaleX, y: y0 * scaleY,
              width: (x1 - x0) * scaleX, height: (y1 - y0) * scaleY });
            before = ' ';
          }
        }
      }
    }
    return runs;
  }

  dispose() {
    this.lifetime.abort();
    void this.worker?.then((worker) => worker.terminate()).catch(() => {});
  }

  private async untilClosed<T>(work: () => Promise<T>) {
    const signal = this.lifetime.signal;
    signal.throwIfAborted();
    let abort = () => {};
    const closed = new Promise<never>((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
    });
    try {
      return await Promise.race([closed, work()]);
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }

  private async create() {
    this.lifetime.signal.throwIfAborted();
    let rejectStartup: (error: unknown) => void = () => {};
    const startupFailure = new Promise<never>((_, reject) => { rejectStartup = reject; });
    const worker = await Promise.race([startupFailure, createWorker(['kor', 'eng'], OEM.LSTM_ONLY, {
      workerPath, corePath, langPath: VIEWER_OCR_MODELS_PATH, workerBlobURL: false, cacheMethod: 'none', errorHandler: (error) => rejectStartup(error),
    })]);
    rejectStartup = () => {};
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    return worker;
  }
}
