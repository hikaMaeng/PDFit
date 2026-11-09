import type { Annotation } from '../../../common/protocol/annotations/index.js';
import type { AnnotationPageProjection } from '../../annotation/coordinates.js';
import { pageRectToLayerRect } from '../../annotation/coordinates.js';
import { annotationBounds } from '../../annotation/model.js';

type Props = { annotation: Annotation; projection: AnnotationPageProjection };

/** Renders the selection bounds and four resize handles. */
export function AnnotationSelection({ annotation, projection }: Props) {
  const rect = pageRectToLayerRect(projection, annotationBounds(annotation));
  const handles = [
    { key: 'nw', x: rect.x, y: rect.y },
    { key: 'ne', x: rect.x + rect.width, y: rect.y },
    { key: 'sw', x: rect.x, y: rect.y + rect.height },
    { key: 'se', x: rect.x + rect.width, y: rect.y + rect.height },
  ] as const;
  return <g data-testid="annotation-selection">
    <rect x={rect.x} y={rect.y} width={Math.max(rect.width, 1)} height={Math.max(rect.height, 1)} fill="none" stroke="#3b82f6" strokeDasharray="5 3" vectorEffect="non-scaling-stroke" />
    {handles.map((handle) => <rect key={handle.key} data-testid={`annotation-resize-${handle.key}`} data-annotation-id={annotation.id} data-resize-handle={handle.key} x={handle.x - 5} y={handle.y - 5} width="10" height="10" fill="#fff" stroke="#2563eb" style={{ pointerEvents: 'all', cursor: `${handle.key}-resize` }} />)}
  </g>;
}
