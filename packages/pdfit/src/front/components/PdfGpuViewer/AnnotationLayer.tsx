import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PdfGpuViewerController } from '@pdfgpu/core';
import type { Annotation, AnnotationPoint, AnnotationStyle, AnnotationTool } from '../../../common/protocol/annotations/index.js';
import { annotationBounds, annotationFromGesture, createTextAnnotation, resizeAnnotation, translateAnnotation } from '../../annotation/model.js';
import { layerPointToPagePoint, pagePointToLayerPoint, pageRectToLayerRect, projectAnnotationPages } from '../../annotation/coordinates.js';

type Props = { controller: PdfGpuViewerController | null; annotations: readonly Annotation[]; visiblePages: readonly number[]; viewportElement: HTMLElement | null; documentId: string; tool: AnnotationTool; style: AnnotationStyle; selectedId: string | null; onSelect: (id: string | null) => void; onChange: (annotations: Annotation[]) => void };
type Gesture = { pageIndex: number; start: AnnotationPoint; end: AnnotationPoint; points: AnnotationPoint[] };
type EditGesture = { annotation: Annotation; start: AnnotationPoint; handle: 'move' | 'nw' | 'ne' | 'sw' | 'se' };
type TextDraft = { id: string | null; pageIndex: number; point: AnnotationPoint; width: number; height: number; fontSize: number; text: string };

/** Viewer-sized SVG surface for non-destructive PDF annotations. */
export function AnnotationLayer({ controller, annotations, visiblePages, viewportElement, documentId, tool, style, selectedId, onSelect, onChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [editGesture, setEditGesture] = useState<EditGesture | null>(null);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const projections = useMemo(() => controller ? projectAnnotationPages(controller, visiblePages) : new Map(), [controller, visiblePages]);

  const eventPoint = (event: ReactPointerEvent<SVGSVGElement>) => {
    const svgRect = svgRef.current?.getBoundingClientRect();
    if (!svgRect || !viewportElement) return null;
    const shell = [...viewportElement.querySelectorAll<HTMLElement>('[data-pdfgpu-page-shell="true"]')].find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    });
    if (!shell) return null;
    const pageIndex = Number(shell.dataset.pageIndex);
    const projection = projections.get(pageIndex);
    if (!projection) return null;
    return { pageIndex, point: layerPointToPagePoint(projection, { x: event.clientX - svgRect.left, y: event.clientY - svgRect.top }) };
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (tool === 'select') {
      const target = (event.target as Element).closest<SVGElement>('[data-annotation-id]');
      if (!target) { onSelect(null); return; }
      const annotation = annotations.find((item) => item.id === target.dataset.annotationId);
      const resolved = eventPoint(event);
      if (!annotation || !resolved || resolved.pageIndex !== annotation.pageIndex) return;
      onSelect(annotation.id); event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
      setEditGesture({ annotation, start: resolved.point, handle: (target.dataset.resizeHandle as EditGesture['handle']) ?? 'move' });
      return;
    }
    if (tool === 'text') {
      if ((event.target as Element).closest('textarea')) return;
      const resolved = eventPoint(event);
      if (!resolved) return;
      event.preventDefault(); event.stopPropagation();
      setTextDraft({ id: null, pageIndex: resolved.pageIndex, point: resolved.point, width: 180, height: 72, fontSize: 16, text: '' });
      return;
    }
    if (tool === 'bookmark') return;
    const resolved = eventPoint(event);
    if (!resolved) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    setGesture({ pageIndex: resolved.pageIndex, start: resolved.point, end: resolved.point, points: [resolved.point] });
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (editGesture) {
      const resolved = eventPoint(event);
      if (!resolved || resolved.pageIndex !== editGesture.annotation.pageIndex) return;
      const updated = editGesture.handle === 'move'
        ? translateAnnotation(editGesture.annotation, { x: resolved.point.x - editGesture.start.x, y: resolved.point.y - editGesture.start.y })
        : resizeAnnotation(editGesture.annotation, editGesture.handle, resolved.point);
      onChange(annotations.map((annotation) => annotation.id === updated.id ? updated : annotation));
      return;
    }
    if (!gesture) return;
    const resolved = eventPoint(event);
    if (!resolved || resolved.pageIndex !== gesture.pageIndex) return;
    setGesture((current) => current ? { ...current, end: resolved.point, points: [...current.points, resolved.point] } : null);
  };

  const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (editGesture) { setEditGesture(null); return; }
    if (!gesture) return;
    const resolved = eventPoint(event);
    const completed = resolved?.pageIndex === gesture.pageIndex ? annotationFromGesture({ id: crypto.randomUUID(), documentId, pageIndex: gesture.pageIndex, tool, start: gesture.start, end: resolved.point, points: [...gesture.points, resolved.point], style }) : null;
    setGesture(null);
    if (completed) onChange([...annotations, completed]);
  };

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (event.key === 'Escape') onSelect(null);
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) { event.preventDefault(); onChange(annotations.filter((annotation) => annotation.id !== selectedId)); onSelect(null); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [annotations, onChange, onSelect, selectedId]);

  const renderAnnotation = (annotation: Annotation) => {
    const projection = projections.get(annotation.pageIndex);
    if (!projection) return null;
    const common = { 'data-annotation-id': annotation.id, stroke: annotation.style.color, strokeWidth: annotation.style.strokeWidth, opacity: annotation.style.opacity, vectorEffect: 'non-scaling-stroke' as const, style: { pointerEvents: tool === 'select' ? 'visiblePainted' as const : 'none' as const } };
    if (annotation.type === 'rectangle' || annotation.type === 'highlight' || annotation.type === 'circle') {
      const rect = pageRectToLayerRect(projection, annotation.geometry);
      if (annotation.type === 'circle') return <ellipse key={annotation.id} data-testid="annotation-circle" cx={rect.x + rect.width / 2} cy={rect.y + rect.height / 2} rx={rect.width / 2} ry={rect.height / 2} fill={annotation.style.fillColor ?? 'none'} {...common} />;
      return <rect key={annotation.id} data-testid={`annotation-${annotation.type}`} x={rect.x} y={rect.y} width={rect.width} height={rect.height} fill={annotation.type === 'highlight' ? annotation.style.color : annotation.style.fillColor ?? 'none'} {...common} />;
    }
    if (annotation.type === 'line' || annotation.type === 'arrow') {
      const start = pagePointToLayerPoint(projection, annotation.geometry.start); const end = pagePointToLayerPoint(projection, annotation.geometry.end);
      return <line key={annotation.id} data-testid={`annotation-${annotation.type}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} fill="none" markerEnd={annotation.type === 'arrow' ? 'url(#annotation-arrow)' : undefined} {...common} />;
    }
    if (annotation.type === 'text') {
      const rect = pageRectToLayerRect(projection, annotation.geometry);
      return <foreignObject key={annotation.id} data-testid="annotation-text" data-annotation-id={annotation.id} x={rect.x} y={rect.y} width={Math.max(rect.width, 1)} height={Math.max(rect.height, 1)} style={{ pointerEvents: tool === 'select' ? 'all' : 'none', overflow: 'visible' }} onDoubleClick={(event) => { if (tool !== 'select') return; event.stopPropagation(); setTextDraft({ id: annotation.id, pageIndex: annotation.pageIndex, point: { x: annotation.geometry.x, y: annotation.geometry.y }, width: annotation.geometry.width, height: annotation.geometry.height, fontSize: annotation.geometry.fontSize, text: annotation.geometry.text }); }}><div style={{ width: '100%', height: '100%', color: annotation.style.color, opacity: annotation.style.opacity, fontSize: `${annotation.geometry.fontSize * projection.scaleY}px`, lineHeight: 1.25, whiteSpace: 'pre-wrap', overflow: 'hidden', overflowWrap: 'anywhere' }}>{annotation.geometry.text}</div></foreignObject>;
    }
    if (annotation.type === 'ink') {
      const points = annotation.geometry.points.map((point) => pagePointToLayerPoint(projection, point));
      return <polyline key={annotation.id} data-testid="annotation-ink" points={points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" strokeLinecap="round" strokeLinejoin="round" {...common} />;
    }
    return null;
  };

  const renderSelection = () => {
    const annotation = annotations.find((item) => item.id === selectedId);
    const projection = annotation ? projections.get(annotation.pageIndex) : null;
    if (!annotation || !projection) return null;
    const rect = pageRectToLayerRect(projection, annotationBounds(annotation));
    const handles = [{ key: 'nw', x: rect.x, y: rect.y }, { key: 'ne', x: rect.x + rect.width, y: rect.y }, { key: 'sw', x: rect.x, y: rect.y + rect.height }, { key: 'se', x: rect.x + rect.width, y: rect.y + rect.height }] as const;
    return <g data-testid="annotation-selection"><rect x={rect.x} y={rect.y} width={Math.max(rect.width, 1)} height={Math.max(rect.height, 1)} fill="none" stroke="#3b82f6" strokeDasharray="5 3" vectorEffect="non-scaling-stroke" />{handles.map((handle) => <rect key={handle.key} data-testid={`annotation-resize-${handle.key}`} data-annotation-id={annotation.id} data-resize-handle={handle.key} x={handle.x - 5} y={handle.y - 5} width="10" height="10" fill="#fff" stroke="#2563eb" style={{ pointerEvents: 'all', cursor: `${handle.key}-resize` }} />)}</g>;
  };

  const commitTextDraft = () => {
    if (!textDraft) return;
    const current = textDraft.id ? annotations.find((annotation) => annotation.id === textDraft.id && annotation.type === 'text') : null;
    const completed = createTextAnnotation({ id: textDraft.id ?? crypto.randomUUID(), documentId, pageIndex: textDraft.pageIndex, point: textDraft.point, width: textDraft.width, height: textDraft.height, fontSize: textDraft.fontSize, text: textDraft.text, style: current?.style ?? style, timestamp: current?.createdAt });
    if (completed) {
      const next = current ? { ...completed, createdAt: current.createdAt, updatedAt: new Date().toISOString() } : completed;
      onChange(current ? annotations.map((annotation) => annotation.id === current.id ? next : annotation) : [...annotations, next]);
      onSelect(next.id);
    }
    setTextDraft(null);
  };

  const renderTextEditor = () => {
    if (!textDraft) return null;
    const projection = projections.get(textDraft.pageIndex);
    if (!projection) return null;
    const rect = pageRectToLayerRect(projection, { ...textDraft.point, width: textDraft.width, height: textDraft.height });
    return <foreignObject data-testid="annotation-text-editor" x={rect.x} y={rect.y} width={Math.max(rect.width, 120)} height={Math.max(rect.height, 64)} style={{ overflow: 'visible', pointerEvents: 'all' }}><textarea aria-label="annotation text editor" autoFocus value={textDraft.text} onChange={(event) => setTextDraft((current) => current ? { ...current, text: event.target.value } : null)} onBlur={commitTextDraft} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setTextDraft(null); } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); commitTextDraft(); } }} style={{ boxSizing: 'border-box', width: '100%', height: '100%', resize: 'none', border: '1px solid #2563eb', outline: 'none', padding: 4, color: style.color, background: 'rgba(255,255,255,.9)', fontSize: `${textDraft.fontSize * projection.scaleY}px`, lineHeight: 1.25 }} /></foreignObject>;
  };

  const draft = gesture ? annotationFromGesture({ id: 'annotation-draft', documentId, pageIndex: gesture.pageIndex, tool, start: gesture.start, end: gesture.end, points: gesture.points, style: { ...style, opacity: Math.max(style.opacity, 0.65) }, timestamp: '' }) : null;
  return <svg ref={svgRef} data-testid="annotation-layer" aria-label="PDF annotations" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={() => { setGesture(null); setEditGesture(null); }} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'hidden', pointerEvents: tool === 'bookmark' ? 'none' : 'auto', touchAction: 'none', zIndex: 4 }}><defs><marker id="annotation-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 z" fill="context-stroke" /></marker></defs>{annotations.map(renderAnnotation)}{draft ? renderAnnotation(draft) : null}{renderSelection()}{renderTextEditor()}</svg>;
}
