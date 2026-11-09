import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PdfGpuViewerController } from '@pdfgpu/core';
import type { Annotation, AnnotationPoint, AnnotationStyle, AnnotationTool } from '../../../common/protocol/annotations/index.js';
import { annotationFromGesture, createTextAnnotation, resizeAnnotation, translateAnnotation } from '../../annotation/model.js';
import { layerPointToPagePoint, projectAnnotationPages, type AnnotationPageProjection } from '../../annotation/coordinates.js';
import { AnnotationShape } from './AnnotationShape.js';
import { AnnotationSelection } from './AnnotationSelection.js';
import { AnnotationTextEditor, type AnnotationTextDraft } from './AnnotationTextEditor.js';
import { usePdfitI18n } from '../../i18n/usePdfitI18n.js';

type Props = { controller: PdfGpuViewerController | null; annotations: readonly Annotation[]; visiblePages: readonly number[]; viewportElement: HTMLElement | null; documentId: string; tool: AnnotationTool; style: AnnotationStyle; selectedId: string | null; onSelect: (id: string | null) => void; onChange: (annotations: Annotation[]) => void; onCommit: (annotations: Annotation[], previous?: Annotation[]) => void; pageProjections?: ReadonlyMap<number, AnnotationPageProjection>; pageShellSelector?: string };
type Gesture = { pageIndex: number; start: AnnotationPoint; end: AnnotationPoint; points: AnnotationPoint[] };
type EditGesture = { annotation: Annotation; start: AnnotationPoint; before: Annotation[]; handle: 'move' | 'nw' | 'ne' | 'sw' | 'se' };
const TOOL_HINTS: Partial<Record<AnnotationTool, string>> = {
  highlight: '형광펜 활성화 · PDF 위에서 영역을 드래그하세요',
  text: '텍스트 추가 활성화 · PDF 위에서 입력할 위치를 클릭하세요',
  pen: '자유 그리기 활성화 · PDF 위에서 드래그해 그리세요',
  rectangle: '사각형 활성화 · PDF 위에서 영역을 드래그하세요',
  circle: '원 활성화 · PDF 위에서 영역을 드래그하세요',
  line: '선 활성화 · PDF 위에서 시작점부터 끝점까지 드래그하세요',
  arrow: '화살표 활성화 · PDF 위에서 시작점부터 끝점까지 드래그하세요',
};

/** Viewer-sized SVG surface for non-destructive PDF annotations. */
export function AnnotationLayer({ controller, annotations, visiblePages, viewportElement, documentId, tool, style, selectedId, onSelect, onChange, onCommit, pageProjections, pageShellSelector = '[data-pdfgpu-page-shell="true"]' }: Props) {
  const { ui } = usePdfitI18n();
  const svgRef = useRef<SVGSVGElement>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [editGesture, setEditGesture] = useState<EditGesture | null>(null);
  const [textDraft, setTextDraft] = useState<AnnotationTextDraft | null>(null);
  const visiblePageKey = visiblePages.join(',');
  const controllerProjections = useMemo(() => controller ? projectAnnotationPages(controller, visiblePages) : new Map(), [controller, visiblePages]);
  const projections = pageProjections ?? controllerProjections;
  const visiblePageSet = useMemo(() => new Set(visiblePages), [visiblePages]);

  useEffect(() => {
    const currentVisiblePages = new Set(visiblePageKey.split(',').filter(Boolean).map(Number));
    setGesture((current) => current && !currentVisiblePages.has(current.pageIndex) ? null : current);
    setEditGesture((current) => current && !currentVisiblePages.has(current.annotation.pageIndex) ? null : current);
    setTextDraft((current) => current && !currentVisiblePages.has(current.pageIndex) ? null : current);
  }, [visiblePageKey]);

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
    if (!visiblePageSet.has(annotation.pageIndex)) return null;
    const projection = projections.get(annotation.pageIndex);
    if (!projection) return null;
    return <AnnotationShape key={annotation.id} annotation={annotation} projection={projection} tool={tool} onEditText={(textAnnotation) => setTextDraft({ id: textAnnotation.id, pageIndex: textAnnotation.pageIndex, point: { x: textAnnotation.geometry.x, y: textAnnotation.geometry.y }, width: textAnnotation.geometry.width, height: textAnnotation.geometry.height, fontSize: textAnnotation.geometry.fontSize, text: textAnnotation.geometry.text })} />;
  };

  const renderSelection = () => {
    const annotation = annotations.find((item) => item.id === selectedId);
    if (!annotation || !visiblePageSet.has(annotation.pageIndex)) return null;
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
  const cursor = tool === 'highlight' ? 'crosshair' : tool === 'text' ? 'text' : tool === 'pen' || tool === 'rectangle' || tool === 'circle' || tool === 'line' || tool === 'arrow' ? 'crosshair' : 'default';
  const toolHint = TOOL_HINTS[tool] ? ui(TOOL_HINTS[tool]) : null;
  return <>
    <svg ref={svgRef} data-testid="annotation-layer" data-active-tool={tool} aria-label="PDF annotations" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={() => { setGesture(null); setEditGesture(null); }} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'hidden', pointerEvents: tool === 'bookmark' ? 'none' : 'auto', touchAction: 'none', cursor, zIndex: 4 }}><defs><marker id="annotation-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 z" fill="context-stroke" /></marker></defs>{annotations.map(renderAnnotation)}{draft ? renderAnnotation(draft) : null}{renderSelection()}{renderTextEditor()}</svg>
    {toolHint ? <div data-testid="annotation-tool-hint" role="status" style={{ position: 'absolute', top: 12, right: 12, zIndex: 5, pointerEvents: 'none', padding: '7px 10px', borderRadius: 6, color: '#fff', background: 'rgba(24, 24, 27, 0.9)', boxShadow: '0 2px 8px rgba(0, 0, 0, 0.28)', fontSize: 12, fontWeight: 600 }}>{toolHint}</div> : null}
  </>;
}
