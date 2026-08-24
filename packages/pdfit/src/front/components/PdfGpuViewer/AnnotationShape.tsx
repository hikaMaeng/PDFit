import type { Annotation, AnnotationTool } from '../../../common/protocol/annotations/index.js';
import type { AnnotationPageProjection } from '../../annotation/coordinates.js';
import { pagePointToLayerPoint, pageRectToLayerRect } from '../../annotation/coordinates.js';

type Props = {
  annotation: Annotation;
  projection: AnnotationPageProjection;
  tool: AnnotationTool;
  onEditText: (annotation: Extract<Annotation, { type: 'text' }>) => void;
};

/** Renders one persisted annotation in projected viewer coordinates. */
export function AnnotationShape({ annotation, projection, tool, onEditText }: Props) {
  const common = {
    'data-annotation-id': annotation.id,
    stroke: annotation.style.color,
    strokeWidth: annotation.style.strokeWidth,
    opacity: annotation.style.opacity,
    vectorEffect: 'non-scaling-stroke' as const,
    style: { pointerEvents: tool === 'select' ? 'visiblePainted' as const : 'none' as const, cursor: tool === 'select' ? 'move' : 'default' },
  };
  if (annotation.type === 'rectangle' || annotation.type === 'highlight' || annotation.type === 'circle') {
    const rect = pageRectToLayerRect(projection, annotation.geometry);
    if (annotation.type === 'circle') return <ellipse data-testid="annotation-circle" cx={rect.x + rect.width / 2} cy={rect.y + rect.height / 2} rx={rect.width / 2} ry={rect.height / 2} fill={annotation.style.fillColor ?? 'none'} {...common} />;
    return <rect data-testid={`annotation-${annotation.type}`} x={rect.x} y={rect.y} width={rect.width} height={rect.height} fill={annotation.type === 'highlight' ? annotation.style.color : annotation.style.fillColor ?? 'none'} {...common} />;
  }
  if (annotation.type === 'line' || annotation.type === 'arrow') {
    const start = pagePointToLayerPoint(projection, annotation.geometry.start);
    const end = pagePointToLayerPoint(projection, annotation.geometry.end);
    return <line data-testid={`annotation-${annotation.type}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} fill="none" markerEnd={annotation.type === 'arrow' ? 'url(#annotation-arrow)' : undefined} {...common} />;
  }
  if (annotation.type === 'text') {
    const rect = pageRectToLayerRect(projection, annotation.geometry);
    return <foreignObject data-testid="annotation-text" data-annotation-id={annotation.id} x={rect.x} y={rect.y} width={Math.max(rect.width, 1)} height={Math.max(rect.height, 1)} style={{ pointerEvents: tool === 'select' ? 'all' : 'none', overflow: 'visible' }} onDoubleClick={(event) => { if (tool !== 'select') return; event.stopPropagation(); onEditText(annotation); }}>
      <div style={{ width: '100%', height: '100%', color: annotation.style.color, opacity: annotation.style.opacity, fontSize: `${annotation.geometry.fontSize * projection.scaleY}px`, lineHeight: 1.25, whiteSpace: 'pre-wrap', overflow: 'hidden', overflowWrap: 'anywhere' }}>{annotation.geometry.text}</div>
    </foreignObject>;
  }
  if (annotation.type === 'ink') {
    const points = annotation.geometry.points.map((point) => pagePointToLayerPoint(projection, point));
    return <polyline data-testid="annotation-ink" points={points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" strokeLinecap="round" strokeLinejoin="round" {...common} />;
  }
  return null;
}
