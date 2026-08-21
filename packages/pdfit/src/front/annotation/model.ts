import type { Annotation, AnnotationPoint, AnnotationRect, AnnotationStyle, AnnotationTool } from '../../common/protocol/annotations/index.js';

export const DEFAULT_ANNOTATION_STYLE: AnnotationStyle = { color: '#ef4444', opacity: 0.25, strokeWidth: 3, fillColor: null };

/** Returns a normalized rectangle between two PDF page points. */
export function rectFromPoints(start: AnnotationPoint, end: AnnotationPoint): AnnotationRect {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
}

/** Drops near-duplicate pen samples without changing the stroke endpoints. */
export function simplifyInkPoints(points: readonly AnnotationPoint[], minimumDistance = 1.5): AnnotationPoint[] {
  if (points.length <= 2) return [...points];
  const result = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = result[result.length - 1];
    const point = points[index];
    if (Math.hypot(point.x - previous.x, point.y - previous.y) >= minimumDistance) result.push(point);
  }
  result.push(points[points.length - 1]);
  return result;
}

/** Creates a completed annotation from a pointer gesture. */
export function annotationFromGesture(input: { id: string; documentId: string; pageIndex: number; tool: AnnotationTool; start: AnnotationPoint; end: AnnotationPoint; points: readonly AnnotationPoint[]; style?: AnnotationStyle; timestamp?: string }): Annotation | null {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const style = input.style ?? DEFAULT_ANNOTATION_STYLE;
  const base = { id: input.id, documentId: input.documentId, pageIndex: input.pageIndex, style, createdAt: timestamp, updatedAt: timestamp };
  const rect = rectFromPoints(input.start, input.end);
  if (input.tool === 'rectangle' || input.tool === 'circle' || input.tool === 'highlight') {
    if (rect.width < 2 || rect.height < 2) return null;
    return { ...base, type: input.tool, geometry: rect };
  }
  if (input.tool === 'line' || input.tool === 'arrow') {
    if (Math.hypot(input.end.x - input.start.x, input.end.y - input.start.y) < 2) return null;
    return { ...base, type: input.tool, geometry: { start: input.start, end: input.end } };
  }
  if (input.tool === 'pen') {
    const points = simplifyInkPoints(input.points);
    if (points.length < 2) return null;
    return { ...base, type: 'ink', geometry: { points } };
  }
  return null;
}
