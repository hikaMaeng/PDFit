import type { PdfGpuViewerController } from '@pdfgpu/core';
import type { AnnotationPoint, AnnotationRect } from '../../common/protocol/annotations/index.js';

export type AnnotationPageProjection = {
  pageIndex: number;
  left: number;
  top: number;
  scaleX: number;
  scaleY: number;
  rotation?: { a: number; b: number; c: number; d: number };
};

/**
 * Splits PDFGPU's page transform into axis scales for the annotation shapes
 * and a screen-space transform for the SVG group that contains them.
 * See docs/internals.md#webgpu-viewer-contract.
 */
export function projectAnnotationPages(
  controller: PdfGpuViewerController,
  pageIndices: readonly number[],
): Map<number, AnnotationPageProjection> {
  const projections = new Map<number, AnnotationPageProjection>();
  for (const pageIndex of new Set(pageIndices)) {
    const transform = controller.getPageTransform(pageIndex);
    if (!transform) continue;
    const { a, b, c, d, e, f } = transform;
    const scaleX = Math.hypot(a, b);
    const scaleY = Math.hypot(c, d);
    const rotation = b || c ? { a: a / scaleX, b: b / scaleX, c: c / scaleY, d: d / scaleY } : undefined;
    projections.set(pageIndex, { pageIndex, left: e, top: f, scaleX, scaleY, ...(rotation && { rotation }) });
  }
  return projections;
}

/** Rotates the scaled annotation geometry about its projected PDF origin. */
export function annotationSvgTransform(projection: AnnotationPageProjection): string | undefined {
  if (!projection.rotation) return undefined;
  const { a, b, c, d } = projection.rotation;
  const { left, top } = projection;
  return `matrix(${a} ${b} ${c} ${d} ${left - a * left - c * top} ${top - b * left - d * top})`;
}

/** Converts a PDF page point to pixels inside its annotation SVG group. */
export function pagePointToLayerPoint(
  projection: AnnotationPageProjection,
  point: AnnotationPoint,
): AnnotationPoint {
  return {
    x: projection.left + point.x * projection.scaleX,
    y: projection.top + point.y * projection.scaleY,
  };
}

/** Converts a PDF page rectangle to annotation-layer pixels. */
export function pageRectToLayerRect(
  projection: AnnotationPageProjection,
  rect: AnnotationRect,
): AnnotationRect {
  const origin = pagePointToLayerPoint(projection, rect);
  return {
    ...origin,
    width: rect.width * projection.scaleX,
    height: rect.height * projection.scaleY,
  };
}

/** Converts annotation-layer pixels back into stable PDF page coordinates. */
export function layerPointToPagePoint(
  projection: AnnotationPageProjection,
  point: AnnotationPoint,
): AnnotationPoint {
  const x = point.x - projection.left;
  const y = point.y - projection.top;
  if (projection.rotation) {
    const { a, b, c, d } = projection.rotation;
    const determinant = a * d - b * c;
    return {
      x: (d * x - c * y) / determinant / projection.scaleX,
      y: (a * y - b * x) / determinant / projection.scaleY,
    };
  }
  return {
    x: x / projection.scaleX,
    y: y / projection.scaleY,
  };
}
