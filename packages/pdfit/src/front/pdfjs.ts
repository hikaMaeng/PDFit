export type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let pdfJsPromise: Promise<PdfJsModule> | null = null;

/**
 * Load PDF.js once without making the application bootstrap await it.
 * Consumers await this only when they actually need to open/render a PDF.
 */
export function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfJsPromise) {
    pdfJsPromise = Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
    ]).then(([pdfjsLib, workerUrl]) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl.default;
      return pdfjsLib;
    });
  }

  return pdfJsPromise;
}
