import { DEFAULT_COLOR_ADJUSTMENTS, updateColorAdjustments, type PdfGpuColorAdjustments } from '@pdfgpu/core';

export class ViewerSessionModel {
  private colors = DEFAULT_COLOR_ADJUSTMENTS;
  private readonly listeners = new Set<() => void>();

  getColorAdjustments = () => this.colors;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setColorAdjustments = (adjustments: PdfGpuColorAdjustments): void => {
    const next = updateColorAdjustments(this.colors, adjustments);
    if (next === this.colors) return;
    this.colors = next;
    this.listeners.forEach((listener) => listener());
  };
}
