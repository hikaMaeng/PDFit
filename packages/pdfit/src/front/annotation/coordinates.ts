import type { PdfGpuViewerController } from '@pdfgpu/core';
import type { AnnotationPoint, AnnotationRect } from '../../common/protocol/annotations/index.js';

export type AnnotationPageProjection = {
  pageIndex: number;
  left: number;
  top: number;
  scaleX: number;
  scaleY: number;
};

/**
 * Derives the PDF-point to viewer-pixel transform from PDFGPU's canonical
 * overlay projection so bookmarks and annotations cannot drift apart.
 */
export function projectAnnotationPages(
  controller: PdfGpuViewerController,
  pageIndices: readonly number[],
): Map<number, AnnotationPageProjection> {
  const uniquePages = [...new Set(pageIndices)];
  const projections = controller.projectOverlays(uniquePages.map((pageIndex) => ({
    pageIndex,
    rect: { x: 0, y: 0, width: 1, height: 1 },
    borderColor: 'transparent',
  })));

  return new Map(projections.map((projection) => [projection.pageIndex, {
    pageIndex: projection.pageIndex,
    left: projection.left,
    top: projection.top,
    scaleX: projection.width,
    scaleY: projection.height,
  }]));
}

/** Converts a PDF page point to annotation-layer pixels. */
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
  return {
    x: (point.x - projection.left) / projection.scaleX,
    y: (point.y - projection.top) / projection.scaleY,
  };
}
