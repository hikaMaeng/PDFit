import { useId } from 'react';
import { DEFAULT_COLOR_ADJUSTMENTS, sameColorAdjustments, type PdfGpuColorAdjustmentState } from '@pdfgpu/core';

// Match the WebGPU page-tile pipeline for canvas renderers. Keep alpha and
// the original canvas pixel buffer intact so clip capture uses source colors.
export function usePageColorFilter(colors: PdfGpuColorAdjustmentState, enabled = true) {
  const id = useId();
  const active = enabled && !sameColorAdjustments(colors, DEFAULT_COLOR_ADJUSTMENTS);
  return {
    filter: active ? `url("#${id}")` : undefined,
    definition: active ? <PageColorFilter id={id} colors={colors} /> : null,
  };
}

function PageColorFilter({ id, colors }: { id: string; colors: PdfGpuColorAdjustmentState }) {
  const contrastIntercept = (1 - colors.contrast) / 2;
  const brightnessIntercept = (colors.invert ? 1 : 0) + colors.brightness;
  const invertSlope = colors.invert ? -1 : 1;
  const luminance = [0.2126, 0.7152, 0.0722].map((weight) => weight * (1 - colors.saturation));
  const saturationMatrix = luminance.flatMap((_, channel) => [
    ...luminance.map((weight, index) => weight + (index === channel ? colors.saturation : 0)),
    0, 0,
  ]).concat(0, 0, 0, 1, 0).join(' ');

  return <svg width={0} height={0} aria-hidden="true" style={{ position: 'absolute' }}>
    <filter id={id} colorInterpolationFilters="sRGB">
      <feComponentTransfer>
        <feFuncR type="linear" slope={invertSlope} intercept={brightnessIntercept} />
        <feFuncG type="linear" slope={invertSlope} intercept={brightnessIntercept} />
        <feFuncB type="linear" slope={invertSlope} intercept={brightnessIntercept} />
      </feComponentTransfer>
      <feComponentTransfer>
        <feFuncR type="linear" slope={colors.contrast} intercept={contrastIntercept} />
        <feFuncG type="linear" slope={colors.contrast} intercept={contrastIntercept} />
        <feFuncB type="linear" slope={colors.contrast} intercept={contrastIntercept} />
      </feComponentTransfer>
      <feColorMatrix type="matrix" values={saturationMatrix} />
    </filter>
  </svg>;
}
