import type { PdfGpuViewerController } from '@pdfgpu/core';
import type { Annotation } from '../../../common/protocol/annotations/index.js';
import { pageRectToLayerRect, projectAnnotationPages } from '../../annotation/coordinates.js';

type Props = {
  controller: PdfGpuViewerController | null;
  annotations: readonly Annotation[];
  visiblePages: readonly number[];
};

/** Viewer-sized SVG surface for non-destructive PDF annotations. */
export function AnnotationLayer({ controller, annotations, visiblePages }: Props) {
  const projections = controller ? projectAnnotationPages(controller, visiblePages) : new Map();

  return (
    <svg
      data-testid="annotation-layer"
      aria-label="PDF annotations"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'hidden', pointerEvents: 'none', zIndex: 4 }}
    >
      {annotations.map((annotation) => {
        const projection = projections.get(annotation.pageIndex);
        if (!projection || !('width' in annotation.geometry)) return null;
        const rect = pageRectToLayerRect(projection, annotation.geometry);

        if (annotation.type !== 'rectangle') return null;
        return (
          <rect
            key={annotation.id}
            data-testid="annotation-rectangle"
            data-annotation-id={annotation.id}
            x={rect.x}
            y={rect.y}
            width={rect.width}
            height={rect.height}
            fill={annotation.style.fillColor ?? 'none'}
            fillOpacity={annotation.style.opacity}
            stroke={annotation.style.color}
            strokeWidth={annotation.style.strokeWidth}
          />
        );
      })}
    </svg>
  );
}
