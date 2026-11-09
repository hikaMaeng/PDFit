import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Annotation, AnnotationStyle, AnnotationTool } from '../../../common/protocol/annotations/index.js';
import type { AnnotationPageProjection } from '../../annotation/coordinates.js';
import { AnnotationLayer } from '../PdfGpuViewer/AnnotationLayer.js';

type Props = {
  surfaceRef: RefObject<HTMLDivElement>;
  viewportRef: RefObject<HTMLDivElement>;
  pages: readonly (PDFPageProxy | null)[];
  annotations: readonly Annotation[];
  documentId: string;
  tool: AnnotationTool;
  style: AnnotationStyle;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (annotations: Annotation[]) => void;
  onCommit: (annotations: Annotation[], previous?: Annotation[]) => void;
};

const PAGE_SHELL_SELECTOR = '[data-legacy-page-shell="true"]';

/** Projects PDF.js page canvases into the shared annotation surface. */
export function LegacyAnnotationLayer(props: Props) {
  const { surfaceRef, viewportRef, pages } = props;
  const [layoutVersion, setLayoutVersion] = useState(0);

  useEffect(() => {
    const surface = surfaceRef.current;
    const viewport = viewportRef.current;
    if (!surface || !viewport) return;
    let frame = 0;
    const refresh = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        setLayoutVersion((value) => value + 1);
      });
    };
    viewport.addEventListener('scroll', refresh, { passive: true });
    window.addEventListener('resize', refresh);
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refresh);
    resizeObserver?.observe(surface);
    resizeObserver?.observe(viewport);
    const mutationObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(refresh);
    mutationObserver?.observe(viewport, { childList: true, subtree: true });
    refresh();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      viewport.removeEventListener('scroll', refresh);
      window.removeEventListener('resize', refresh);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [surfaceRef, viewportRef, pages]);

  const projections = useMemo(() => {
    void layoutVersion;
    const surface = surfaceRef.current;
    if (!surface) return new Map<number, AnnotationPageProjection>();
    const surfaceRect = surface.getBoundingClientRect();
    const result = new Map<number, AnnotationPageProjection>();
    for (const shell of surface.querySelectorAll<HTMLElement>(PAGE_SHELL_SELECTOR)) {
      const pageIndex = Number(shell.dataset.pageIndex);
      const page = pages[pageIndex];
      const canvas = shell.querySelector('canvas');
      if (!page || !(canvas instanceof HTMLCanvasElement) || !Number.isInteger(pageIndex)) continue;
      const canvasRect = canvas.getBoundingClientRect();
      const viewport = page.getViewport({ scale: 1 });
      if (canvasRect.width <= 0 || canvasRect.height <= 0 || viewport.width <= 0 || viewport.height <= 0) continue;
      result.set(pageIndex, {
        pageIndex,
        left: canvasRect.left - surfaceRect.left,
        top: canvasRect.top - surfaceRect.top,
        scaleX: canvasRect.width / viewport.width,
        scaleY: canvasRect.height / viewport.height,
      });
    }
    return result;
  }, [layoutVersion, pages, surfaceRef]);

  return <AnnotationLayer controller={null} pageProjections={projections} pageShellSelector={PAGE_SHELL_SELECTOR} annotations={props.annotations} visiblePages={[...projections.keys()]} viewportElement={surfaceRef.current} documentId={props.documentId} tool={props.tool} style={props.style} selectedId={props.selectedId} onSelect={props.onSelect} onChange={props.onChange} onCommit={props.onCommit} />;
}
