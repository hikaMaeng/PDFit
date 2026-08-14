export const PDFGPU_DISPLAY_PROGRESS_COMPLETE_AT = 35;

/** Maps the PDFGPU's preview-ready progress range to the complete display range. */
export function interpolatePdfGpuDisplayProgress(sourceProgress: number): number {
  if (!Number.isFinite(sourceProgress)) return 0;
  return Math.min(100, Math.max(0, Math.round((sourceProgress / PDFGPU_DISPLAY_PROGRESS_COMPLETE_AT) * 100)));
}
