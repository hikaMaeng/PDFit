import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PdfGpuViewerController } from '@pdfgpu/core';
import type { Annotation, AnnotationPoint, AnnotationStyle, AnnotationTool } from '../../../common/protocol/annotations/index.js';
import { annotationFromGesture, createTextAnnotation, resizeAnnotation, translateAnnotation } from '../../annotation/model.js';
import { layerPointToPagePoint, projectAnnotationPages, type AnnotationPageProjection } from '../../annotation/coordinates.js';
import { AnnotationShape } from './AnnotationShape.js';
import { AnnotationSelection } from './AnnotationSelection.js';
import { AnnotationTextEditor, type AnnotationTextDraft } from './AnnotationTextEditor.js';

type Props = { controller: PdfGpuViewerController | null; annotations: readonly Annotation[]; visiblePages: readonly number[]; viewportElement: HTMLElement | null; documentId: string; tool: AnnotationTool; style: AnnotationStyle; selectedId: string | null; onSelect: (id: string | null) => void; onChange: (annotations: Annotation[]) => void; onCommit: (annotations: Annotation[], previous?: Annotation[]) => void; pageProjections?: ReadonlyMap<number, AnnotationPageProjection>; pageShellSelector?: string };
type Gesture = { pageIndex: number; start: AnnotationPoint; end: AnnotationPoint; points: AnnotationPoint[] };
type EditGesture = { annotation: Annotation; start: AnnotationPoint; before: Annotation[]; handle: 'move' | 'nw' | 'ne' | 'sw' | 'se' };

/** Viewer-sized SVG surface for non-destructive PDF annotations. */
export function AnnotationLayer({ controller, annotations, visiblePages, viewportElement, documentId, tool, style, selectedId, onSelect, onChange, onCommit, pageProjections, pageShellSelector = '[data-pdfgpu-page-shell="true"]' }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [editGesture, setEditGesture] = useState<EditGesture | null>(null);
  const [textDraft, setTextDraft] = useState<AnnotationTextDraft | null>(null);
  const controllerProjections = useMemo(() => controller ? projectAnnotationPages(controller, visiblePages) : new Map(), [controller, visiblePages]);
  const projections = pageProjections ?? controllerProjections;

  const eventPoint = (event: ReactPointerEvent<SVGSVGElement>) => {
    const svgRect = svgRef.current?.getBoundingClientRect();
    if (!svgRect || !viewportElement) return null;
    const shell = [...viewportElement.querySelectorAll<HTMLElement>(pageShellSelector)].find((candidate) => {
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
      setEditGesture({ annotation, start: resolved.point, before: [...annotations], handle: (target.dataset.resizeHandle as EditGesture['handle']) ?? 'move' });
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
    if (editGesture) { onCommit([...annotations], editGesture.before); setEditGesture(null); return; }
    if (!gesture) return;
    const resolved = eventPoint(event);
    const completed = resolved?.pageIndex === gesture.pageIndex ? annotationFromGesture({ id: crypto.randomUUID(), documentId, pageIndex: gesture.pageIndex, tool, start: gesture.start, end: resolved.point, points: [...gesture.points, resolved.point], style }) : null;
    setGesture(null);
    if (completed) onCommit([...annotations, completed]);
  };

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (event.key === 'Escape') onSelect(null);
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) { event.preventDefault(); onCommit(annotations.filter((annotation) => annotation.id !== selectedId)); onSelect(null); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [annotations, onCommit, onSelect, selectedId]);

  const renderAnnotation = (annotation: Annotation) => {
    const projection = projections.get(annotation.pageIndex);
    if (!projection) return null;
    return <AnnotationShape key={annotation.id} annotation={annotation} projection={projection} tool={tool} onEditText={(textAnnotation) => setTextDraft({ id: textAnnotation.id, pageIndex: textAnnotation.pageIndex, point: { x: textAnnotation.geometry.x, y: textAnnotation.geometry.y }, width: textAnnotation.geometry.width, height: textAnnotation.geometry.height, fontSize: textAnnotation.geometry.fontSize, text: textAnnotation.geometry.text })} />;
  };

  const renderSelection = () => {
    const annotation = annotations.find((item) => item.id === selectedId);
    const projection = annotation ? projections.get(annotation.pageIndex) : null;
    if (!annotation || !projection) return null;
    return <AnnotationSelection annotation={annotation} projection={projection} />;
  };

  const commitTextDraft = () => {
    if (!textDraft) return;
    const current = textDraft.id ? annotations.find((annotation) => annotation.id === textDraft.id && annotation.type === 'text') : null;
    const completed = createTextAnnotation({ id: textDraft.id ?? crypto.randomUUID(), documentId, pageIndex: textDraft.pageIndex, point: textDraft.point, width: textDraft.width, height: textDraft.height, fontSize: textDraft.fontSize, text: textDraft.text, style: current?.style ?? style, timestamp: current?.createdAt });
    if (completed) {
      const next = current ? { ...completed, createdAt: current.createdAt, updatedAt: new Date().toISOString() } : completed;
      onCommit(current ? annotations.map((annotation) => annotation.id === current.id ? next : annotation) : [...annotations, next]);
      onSelect(next.id);
    }
    setTextDraft(null);
  };

  const renderTextEditor = () => {
    if (!textDraft) return null;
    const projection = projections.get(textDraft.pageIndex);
    if (!projection) return null;
    return <AnnotationTextEditor draft={textDraft} projection={projection} style={style} onChange={setTextDraft} onCommit={commitTextDraft} onCancel={() => setTextDraft(null)} />;
  };

  const draft = gesture ? annotationFromGesture({ id: 'annotation-draft', documentId, pageIndex: gesture.pageIndex, tool, start: gesture.start, end: gesture.end, points: gesture.points, style: { ...style, opacity: Math.max(style.opacity, 0.65) }, timestamp: '' }) : null;
  return <svg ref={svgRef} data-testid="annotation-layer" aria-label="PDF annotations" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={() => { setGesture(null); setEditGesture(null); }} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'hidden', pointerEvents: tool === 'bookmark' ? 'none' : 'auto', touchAction: 'none', zIndex: 4 }}><defs><marker id="annotation-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 z" fill="context-stroke" /></marker></defs>{annotations.map(renderAnnotation)}{draft ? renderAnnotation(draft) : null}{renderSelection()}{renderTextEditor()}</svg>;
}
