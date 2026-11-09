/**
 * CSS pixels per PDF point at Acrobat-compatible 100% zoom (96 CSS dpi / 72 PDF points per inch).
 * @see ../../../../docs/internals.md#viewer-zoom-contract
 */
export const PDF_CSS_UNITS = 96 / 72;

/**
 * Initial zoom for documents without persisted viewer state.
 * @see ../../../../docs/internals.md#viewer-zoom-contract
 */
export const DEFAULT_VIEWER_ZOOM = 1;

/**
 * Converts the user-facing zoom ratio into the scale expected by PDF.js viewports.
 * @see ../../../../docs/internals.md#viewer-zoom-contract
 */
export function toPdfJsViewportScale(zoom: number): number {
  return zoom * PDF_CSS_UNITS;
}

/**
 * Converts an available CSS-pixel extent into the user-facing Acrobat-compatible zoom ratio.
 * @see ../../../../docs/internals.md#viewer-zoom-contract
 */
export function fitZoomForCssExtent(availableCssPixels: number, pdfPointExtent: number): number {
  return availableCssPixels / (pdfPointExtent * PDF_CSS_UNITS);
}
