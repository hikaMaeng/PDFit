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

/** Creates a multiline free-text annotation anchored in PDF page coordinates. */
export function createTextAnnotation(input: { id: string; documentId: string; pageIndex: number; point: AnnotationPoint; text: string; style?: AnnotationStyle; fontSize?: number; width?: number; height?: number; timestamp?: string }): Annotation | null {
  const text = input.text.trim();
  if (!text) return null;
  const timestamp = input.timestamp ?? new Date().toISOString();
  return {
    id: input.id,
    documentId: input.documentId,
    pageIndex: input.pageIndex,
    type: 'text',
    geometry: { x: input.point.x, y: input.point.y, width: input.width ?? 180, height: input.height ?? 72, text, fontSize: input.fontSize ?? 16 },
    style: input.style ?? DEFAULT_ANNOTATION_STYLE,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/** Returns the editable PDF-coordinate bounds for any annotation kind. */
export function annotationBounds(annotation: Annotation): AnnotationRect {
  if (annotation.type === 'rectangle' || annotation.type === 'circle' || annotation.type === 'highlight') return annotation.geometry;
  if (annotation.type === 'text') return { x: annotation.geometry.x, y: annotation.geometry.y, width: annotation.geometry.width, height: annotation.geometry.height };
  if (annotation.type === 'line' || annotation.type === 'arrow') return rectFromPoints(annotation.geometry.start, annotation.geometry.end);
  const xs = annotation.geometry.points.map((point) => point.x); const ys = annotation.geometry.points.map((point) => point.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/** Moves an annotation without changing its PDF-coordinate size. */
export function translateAnnotation(annotation: Annotation, delta: AnnotationPoint, timestamp = new Date().toISOString()): Annotation {
  const move = (point: AnnotationPoint) => ({ x: point.x + delta.x, y: point.y + delta.y });
  if (annotation.type === 'rectangle' || annotation.type === 'circle' || annotation.type === 'highlight' || annotation.type === 'text') return { ...annotation, geometry: { ...annotation.geometry, ...move(annotation.geometry) }, updatedAt: timestamp } as Annotation;
  if (annotation.type === 'line' || annotation.type === 'arrow') return { ...annotation, geometry: { start: move(annotation.geometry.start), end: move(annotation.geometry.end) }, updatedAt: timestamp } as Annotation;
  return { ...annotation, geometry: { points: annotation.geometry.points.map(move) }, updatedAt: timestamp };
}

/** Resizes an annotation from one corner while preserving its type-specific geometry. */
export function resizeAnnotation(annotation: Annotation, handle: 'nw' | 'ne' | 'sw' | 'se', point: AnnotationPoint, timestamp = new Date().toISOString()): Annotation {
  const old = annotationBounds(annotation);
  const opposite = { x: handle.includes('w') ? old.x + old.width : old.x, y: handle.includes('n') ? old.y + old.height : old.y };
  const next = rectFromPoints(opposite, point);
  const scale = (value: AnnotationPoint) => ({ x: next.x + ((value.x - old.x) / Math.max(old.width, 0.001)) * next.width, y: next.y + ((value.y - old.y) / Math.max(old.height, 0.001)) * next.height });
  if (annotation.type === 'rectangle' || annotation.type === 'circle' || annotation.type === 'highlight') return { ...annotation, geometry: next, updatedAt: timestamp };
  if (annotation.type === 'text') return { ...annotation, geometry: { ...annotation.geometry, ...next }, updatedAt: timestamp };
  if (annotation.type === 'line' || annotation.type === 'arrow') return { ...annotation, geometry: { start: scale(annotation.geometry.start), end: scale(annotation.geometry.end) }, updatedAt: timestamp } as Annotation;
  return { ...annotation, geometry: { points: annotation.geometry.points.map(scale) }, updatedAt: timestamp };
}
