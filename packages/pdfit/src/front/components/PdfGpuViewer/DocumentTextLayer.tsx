import { memo, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type RefObject } from 'react';
import { Box, Button } from '@mui/material';
import type { PdfGpuViewerController } from '@pdfgpu/core';
import type { PageTextModel, SelectablePageText } from '../../viewer/text-selection/pageTextModel.js';
import { activePdfTextSelection, copyPdfText } from '../../viewer/text-selection/selectionDom.js';

import { usePdfitI18n } from '../../i18n/usePdfitI18n.js';
import { RSC } from './resource.js';
import { useTouchTextSelection } from './useTouchTextSelection.js';

const FONT_FAMILY = 'sans-serif';

const TextPage = memo(function TextPage({ pageIndex, page }: { pageIndex: number; page: SelectablePageText }) {
  const scales = useMemo(() => {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return [];
    return page.runs.map((run) => {
      ctx.font = `${run.height}px ${FONT_FAMILY}`;
      const measured = ctx.measureText(run.text).width;
      return measured > 0 ? run.width / measured : 1;
    });
  }, [page]);

  return <div
    data-testid="pdf-selectable-page"
    data-page-index={pageIndex}
    data-text-source={page.source}
    style={{ position: 'absolute', left: 0, top: 0, width: page.width, height: page.height, overflow: 'hidden', transformOrigin: '0 0' }}
  >
    {page.runs.map((run, index) => <span
      key={index}
      data-pdf-text-run=""
      data-before={index === 0 ? '\n\n' : run.before}
      dir={run.direction === 'rtl' ? 'rtl' : 'ltr'}
      style={{ position: 'absolute', left: run.x, top: run.y, fontSize: run.height, fontFamily: FONT_FAMILY, lineHeight: 1,
        transformOrigin: '0 0', transform: `rotate(${run.angle ?? 0}rad) scaleX(${scales[index] ?? 1})` }}
    >{run.text}</span>)}
  </div>;
});

type Props = {
  controller: PdfGpuViewerController;
  model: PageTextModel;
  viewportRef: RefObject<HTMLDivElement>;
  enabled: boolean;
  visiblePages: readonly number[];
  activePageIndex: number;
};

export function DocumentTextLayer({ controller, model, viewportRef, enabled, visiblePages, activePageIndex }: Props) {
  const { t } = usePdfitI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const { showCopy, copy, ...touch } = useTouchTextSelection(rootRef, enabled);
  const pageKey = enabled ? visiblePages.join(',') : '';
  const pageIndices = useMemo(() => pageKey ? pageKey.split(',').map(Number) : [], [pageKey]);
  const version = useSyncExternalStore(model.subscribe, model.getVersion, model.getVersion);

  useEffect(() => {
    const otherPages = pageIndices.filter((index) => index !== activePageIndex);
    model.show(pageIndices.includes(activePageIndex) ? [activePageIndex, ...otherPages] : otherPages);
  }, [model, activePageIndex, pageIndices]);

  useEffect(() => () => model.show([]), [model]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const viewport = viewportRef.current;
    if (!enabled || !root || !viewport) return;
    const pages = root.querySelectorAll<HTMLElement>('[data-page-index]');
    const project = () => {
      for (const page of pages) {
        const transform = controller.getPageTransform(Number(page.dataset.pageIndex));
        if (!transform) {
          page.style.visibility = 'hidden';
          continue;
        }
        const { a, b, c, d, e, f } = transform;
        page.style.visibility = '';
        page.style.transform = `matrix(${a},${b},${c},${d},${e - viewport.scrollLeft},${f})`;
      }
    };
    const unsubscribe = controller.subscribe(project);
    viewport.addEventListener('scroll', project, { passive: true });
    return () => {
      unsubscribe();
      viewport.removeEventListener('scroll', project);
    };
  }, [controller, enabled, pageIndices, version, viewportRef]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root) return;
    const copy = (event: ClipboardEvent) => copyPdfText(event, root);
    document.addEventListener('copy', copy);
    return () => {
      document.removeEventListener('copy', copy);
      const active = activePdfTextSelection();
      if (active?.layer === root) active.selection.removeAllRanges();
    };
  }, [controller, enabled]);

  if (!enabled) return null;
  return <Box ref={rootRef} data-pdf-document-text="" {...touch} sx={{
    position: 'absolute', inset: 0, zIndex: 3, overflow: 'hidden', pointerEvents: 'none',
    '& [data-pdf-text-run]': { whiteSpace: 'pre', color: 'transparent', pointerEvents: 'auto', cursor: 'text',
      userSelect: 'text', WebkitUserSelect: 'text',
      '&::selection': { color: 'transparent', backgroundColor: 'rgba(64,132,255,0.45)' },
    },
  }}>
    {pageIndices.map((pageIndex) => {
      const page = model.getPage(pageIndex);
      return page?.runs.length ? <TextPage key={pageIndex} pageIndex={pageIndex} page={page} /> : null;
    })}
    {showCopy && <Button size="small" variant="contained" onMouseDown={(event) => event.preventDefault()}
      onClick={() => void copy()} sx={{ position: 'absolute', bottom: 12, insetInlineEnd: 18, pointerEvents: 'auto' }}>
      {t(RSC.copySelectedText)}
    </Button>}
  </Box>;
}
