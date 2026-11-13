import { usePdfitI18n } from '../../i18n/usePdfitI18n.js';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, Box } from '@mui/material';
import {
  createPdfDocumentEngine,
  createPdfGpuViewer,
  type PdfGpuViewerController,
  type PdfGpuViewerState,
} from '@pdfgpu/core';
import type { ViewerStatePayload } from '../../api/viewerState.js';
import type { BookmarkRecord, UpdateBookmarkRequest } from '../../../common/protocol/bookmarks/index.js';
import type { PdfGpuCaptureResult } from '@pdfgpu/core';
import {
  createViewerInteractionState,
  normalizeViewerPage,
  reduceViewerInteraction,
  viewerModeFromParts,
} from '@pdfgpu/core';
import { interpolatePdfGpuDisplayProgress } from './loadingProgress.js';
import { PdfLoadingProgress } from '../PdfLoadingProgress.js';
import { AnnotationLayer } from './AnnotationLayer.js';
import { usePdfAnnotations } from './usePdfAnnotations.js';
import { ViewerToolbar } from './ViewerToolbar.js';
import { BookmarkSidebar } from './BookmarkSidebar.js';
import { BookmarkEditorDialog } from './BookmarkEditorDialog.js';
import { BookmarkOverlayLayer } from './BookmarkOverlayLayer.js';
import { usePdfBookmarks } from './usePdfBookmarks.js';
import { ANNOTATION_RAIL_WIDTH, AnnotationControls } from './AnnotationControls.js';
import { usePdfPan } from './usePdfPan.js';
import { forwardPageModeWheel } from '../viewerWheel.js';
import { useNonPassiveWheel } from '../useNonPassiveWheel.js';
import { DEFAULT_VIEWER_ZOOM } from '../PdfViewer/pdfDisplayScale.js';
import { usePageSwipe } from '../usePageSwipe.js';
import {
  nextSpreadToggleMemory,
  readSpreadCoverPreference,
  spreadToggleTarget,
  writeSpreadCoverPreference,
  type SpreadCover,
  type SpreadToggleMemory,
} from '../../viewer/spreadPairing.js';

// see docs/internals.md#webgpu-viewer-contract

type Props = {
  url: string;
  initialPage?: number | null;
  initialScale?: number;
  initialFitMode?: 'none' | 'width' | 'height';
  initialViewMode?: 'scroll' | 'single' | 'double';
  inverted?: boolean;
  onToggleInverted?: () => void;
  initialScrollTop?: number;
  onStateChange?: (state: Omit<ViewerStatePayload, 'uiHidden'>) => void;
  onUnavailable?: () => void;
  uiHidden?: boolean;
  bookmarks?: BookmarkRecord[];
  onBookmarkCaptured?: (capture: PdfGpuCaptureResult) => Promise<BookmarkRecord | void>;
  onBookmarkUpdated?: (id: string, request: UpdateBookmarkRequest) => Promise<void>;
  onBookmarkDeleted?: (id: string) => Promise<void>;
};

const EMPTY_STATE: PdfGpuViewerState = {
  backend: 'unsupported',
  zoom: DEFAULT_VIEWER_ZOOM,
  pageCount: 0,
  provider: 'in-memory',
  engine: 'in-memory',
  viewMode: 'single',
  spreadPlacement: 'first-right',
  spreadPairing: 'alone',
  fitMode: 'none',
  scrollMode: 'continuous',
  queueDepth: 0,
  renderQuality: 'idle',
  detailDpi: 192,
  visiblePages: [],
  loading: true,
  loadPhase: 'opening',
  loadProgress: 0,
  loadProgressDeterminate: false,
  loadedPages: 0,
  loadPageCount: 0,
  error: null,
  activePage: undefined,
};

function toLegacyViewMode(state: PdfGpuViewerState): ViewerStatePayload['viewMode'] {
  if (state.scrollMode === 'continuous') return 'scroll';
  return state.viewMode === 'spread' ? 'double' : 'single';
}

export default function PdfGpuViewer({
  url,
  initialPage,
  initialScale,
  initialFitMode,
  initialViewMode,
  inverted = false,
  onToggleInverted,
  initialScrollTop,
  onStateChange,
  onUnavailable,
  uiHidden = false,
  bookmarks = [],
  onBookmarkCaptured,
  onBookmarkUpdated,
  onBookmarkDeleted,
}: Props) {
  const { ui } = usePdfitI18n();
  const viewportRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<PdfGpuViewerController | null>(null);
  const [controller, setController] = useState<PdfGpuViewerController | null>(null);
  const annotation = usePdfAnnotations(url);
  const bookmark = usePdfBookmarks({ enabled: annotation.tool === 'bookmark', controller, onCaptured: onBookmarkCaptured, onUpdated: onBookmarkUpdated, onDeleted: onBookmarkDeleted });
  const pan = usePdfPan(viewportRef, annotation.tool === 'select', () => annotation.setSelectedId(null));
  // Wheel on the surface around the core viewport: page modes forward it to the viewport,
  // continuous scroll pans with the select tool. Non-passive so both can call preventDefault.
  const surfaceWheelRef = useNonPassiveWheel<HTMLDivElement>((event) => {
    if (controller?.getState().scrollMode === 'page') forwardPageModeWheel(event, viewportRef.current, true);
    else if (annotation.tool === 'select') pan.wheel(event);
  });
  const [initError, setInitError] = useState<string | null>(null);
  const [pageInput, setPageInput] = useState('1');
  const initialViewAppliedRef = useRef<{
    controller: PdfGpuViewerController;
    page: number | null | undefined;
    scrollTop: number | undefined;
  } | null>(null);

  const subscribe = useCallback((listener: (state: PdfGpuViewerState) => void) => {
    return controller?.subscribe(listener) ?? (() => {});
  }, [controller]);
  const getSnapshot = useCallback(() => controller?.getState() ?? EMPTY_STATE, [controller]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const currentPage = state.activePage ?? 1;
  const activePageIndex = Math.max(0, currentPage - 1);
  const spreadStartPageIndex = activePageIndex === 0
    ? 0
    : activePageIndex % 2 === 1 ? activePageIndex : activePageIndex - 1;
  const annotationPageIndices = state.scrollMode === 'page'
    ? state.viewMode === 'spread'
      ? [spreadStartPageIndex, spreadStartPageIndex + 1].filter((pageIndex) => pageIndex < state.pageCount)
      : [activePageIndex]
    : state.visiblePages;
  const displayLoadProgress = interpolatePdfGpuDisplayProgress(state.loadProgress);
  const overlayProjections = controller?.projectOverlays(bookmarks.map((bookmark) => ({
    pageIndex: bookmark.pageIndex,
    rect: bookmark.rect,
    borderColor: bookmark.borderColor,
    fillColor: bookmark.fillColor ?? undefined,
    fillOpacity: bookmark.fillOpacity,
    comment: bookmark.comment ?? undefined,
  }))) ?? [];
  const visibleOverlayBookmarks = bookmarks.filter((bookmark) => state.visiblePages.includes(bookmark.pageIndex));
  const goToPage = useCallback((page: number) => {
    const mode = viewerModeFromParts(state.scrollMode, state.viewMode);
    const target = normalizeViewerPage(page, state.pageCount, mode, state.spreadPairing);
    controller?.scrollToPage(target - 1);
  }, [controller, state.pageCount, state.scrollMode, state.spreadPairing, state.viewMode]);
  // A pairing switch lands on the new row containing the current page; switching straight
  // back returns to the page the reader switched from (see spreadPairing.ts).
  const spreadToggleMemoryRef = useRef<SpreadToggleMemory>(null);
  useEffect(() => { spreadToggleMemoryRef.current = null; }, [controller]);
  const selectSpreadCover = useCallback((next: SpreadCover) => {
    if (!controller) return;
    const current = controller.getState();
    const page = current.activePage ?? 1;
    const target = spreadToggleTarget(spreadToggleMemoryRef.current, page);
    spreadToggleMemoryRef.current = nextSpreadToggleMemory(spreadToggleMemoryRef.current, page, current.pageCount, next);
    writeSpreadCoverPreference(next);
    controller.setSpreadPairing(next);
    if (target !== page) controller.scrollToPage(target - 1);
  }, [controller]);
  const pageSwipe = usePageSwipe(
    viewportRef,
    state.scrollMode === 'page' && (annotation.tool === 'select' || annotation.tool === 'bookmark'),
    () => goToPage(currentPage - (state.viewMode === 'spread' ? 2 : 1)),
    () => goToPage(currentPage + (state.viewMode === 'spread' ? 2 : 1)),
    state.fitMode === 'page' || state.fitMode === 'height',
  );

  useEffect(() => {
    let cancelled = false;
    let nextController: PdfGpuViewerController | null = null;

    const initialize = async () => {
      const viewport = viewportRef.current;
      if (!viewport) return;

      try {
        const provider = await createPdfDocumentEngine();
        nextController = await createPdfGpuViewer({
          container: viewport,
          provider,
          providerKind: 'in-memory',
          initialZoom: initialScale ?? DEFAULT_VIEWER_ZOOM,
          minZoom: 0.25,
          maxZoom: 5,
          viewMode: initialViewMode === 'double' ? 'spread' : 'single',
          // Reader's two-page pairing, shared with the PDF.js viewer (default (1,2),(3,4)).
          spreadPairing: readSpreadCoverPreference(),
          fitMode: initialFitMode === 'height' && initialViewMode === 'double' ? 'page' : initialFitMode ?? 'none',
          scrollMode: initialViewMode === 'scroll' ? 'continuous' : 'page',
          overscanPages: 2,
          pageGap: 16,
          spreadGap: 20,
          detailDpi: 192,
        });

        if (cancelled) {
          nextController.dispose();
          return;
        }

        controllerRef.current = nextController;
        setController(nextController);
        await nextController.load(url);
        if (cancelled) return;
        if (initialFitMode === 'height' && initialViewMode === 'double') nextController.fitPage();
        else if (initialFitMode && initialFitMode !== 'none') nextController.setFitMode(initialFitMode);
        setInitError(null);
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'WebGPU PDF viewer initialization failed';
        console.error('[pdfit] PDFGPU viewer unavailable; using PDF.js fallback', { message, documentUrl: url });
        setInitError(message);
        onUnavailable?.();
      }
    };

    void initialize();
    return () => {
      cancelled = true;
      nextController?.dispose();
      controllerRef.current = null;
      setController(null);
    };
  }, [initialFitMode, initialScale, initialViewMode, onUnavailable, url]);

  useEffect(() => {
    if (!state.activePage) return;
    setPageInput(String(state.activePage));
  }, [state.activePage]);

  useEffect(() => {
    if (!state.activePage) return;
    const legacyState: Omit<ViewerStatePayload, 'uiHidden'> = {
      page: state.activePage,
      scale: state.zoom,
      fitMode: state.fitMode === 'page' ? state.viewMode === 'spread' ? 'height' : 'none' : state.fitMode,
      viewMode: toLegacyViewMode(state),
      inverted,
      scrollTop: viewportRef.current?.scrollTop ?? 0,
    };
    onStateChange?.(legacyState);
  }, [inverted, onStateChange, state]);

  useEffect(() => {
    const canvas = viewportRef.current?.querySelector('canvas');
    if (canvas) canvas.style.filter = inverted ? 'invert(1)' : 'none';
  }, [inverted, state.pageCount, state.renderQuality]);

  useEffect(() => {
    // @pdfgpu/core >= 0.1.10 binds the same paging keys on its focused viewport and calls
    // preventDefault when it navigates. This window listener covers focus outside the
    // viewport only; handling an already-consumed event would page twice.
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      const editable = !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (!controller || !state.pageCount || editable) return;
      const transition = reduceViewerInteraction(
        createViewerInteractionState({
          page: currentPage,
          pageCount: state.pageCount,
          mode: viewerModeFromParts(state.scrollMode, state.viewMode),
          pairing: state.spreadPairing,
        }),
        { type: 'key', key: event.key, editableTarget: false },
      );
      if (transition.preventDefault) event.preventDefault();
      for (const effect of transition.effects) {
        if (effect.type === 'navigate') goToPage(effect.page);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [controller, currentPage, goToPage, state.pageCount, state.scrollMode, state.spreadPairing, state.viewMode]);

  // The saved page is applied when loading reaches 'ready'. Navigation already works while
  // previews are still rendering (and @pdfgpu/core 0.1.10 reaches 'ready' later), so a page
  // turn made before 'ready' must win: re-applying the saved page then yanked the reader back.
  // Key: the controller instance (one per opened document); set when the active page leaves
  // page 1 before the first apply; cleared when the controller changes.
  const movedBeforeInitialViewRef = useRef<PdfGpuViewerController | null>(null);
  useEffect(() => {
    if (!controller || state.loadPhase === 'ready') return;
    if (initialViewAppliedRef.current?.controller === controller) return;
    if ((state.activePage ?? 1) !== 1) movedBeforeInitialViewRef.current = controller;
  }, [controller, state.activePage, state.loadPhase]);

  useEffect(() => {
    if (!controller || state.loadPhase !== 'ready') return;
    const applied = initialViewAppliedRef.current;
    if (applied?.controller === controller && applied.page === initialPage && applied.scrollTop === initialScrollTop) return;
    const firstApply = applied?.controller !== controller;
    initialViewAppliedRef.current = { controller, page: initialPage, scrollTop: initialScrollTop };
    if (firstApply && movedBeforeInitialViewRef.current === controller) return;
    if (initialPage != null) goToPage(initialPage);
    if (initialScrollTop && initialScrollTop > 0 && viewportRef.current) {
      viewportRef.current.scrollTop = initialScrollTop;
    }
  }, [controller, goToPage, initialPage, initialScrollTop, state.loadPhase]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!controller || !viewport) return;
    let previousWidth = viewport.clientWidth;
    const observer = new ResizeObserver(() => {
      const nextWidth = viewport.clientWidth;
      if (nextWidth === previousWidth) return;
      previousWidth = nextWidth;
      const current = controller.getState();
      if (current.fitMode !== 'width' && current.fitMode !== 'page') return;
      const page = current.activePage ?? 1;
      controller.setFitMode(current.fitMode);
      requestAnimationFrame(() => controller.scrollToPage(page - 1));
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [controller]);

  const submitPageInput = useCallback((value: string) => {
    const page = Number.parseInt(value, 10);
    if (Number.isFinite(page)) goToPage(page);
    else setPageInput(String(currentPage));
  }, [currentPage, goToPage]);

  const changePageLayout = useCallback((next: 'single' | 'double') => {
    if (!controller) return;
    const current = controller.getState();
    const page = current.activePage ?? 1;
    controller.setViewMode(next === 'double' ? 'spread' : 'single');
    if (next === 'double') {
      if (current.fitMode === 'height' || current.fitMode === 'page') controller.fitPage();
      else controller.fitWidth();
    } else controller.setFitMode(current.fitMode === 'page' ? 'height' : current.fitMode);
    requestAnimationFrame(() => controller.scrollToPage(page - 1));
  }, [controller]);

  const fitHeight = useCallback(() => {
    if (!controller) return;
    if (controller.getState().viewMode === 'spread') controller.fitPage();
    else controller.fitHeight();
  }, [controller]);

  const toggleContinuousScroll = useCallback(() => {
    if (!controller) return;
    const current = controller.getState();
    const page = current.activePage ?? 1;
    controller.setScrollMode(current.scrollMode === 'continuous' ? 'page' : 'continuous');
    controller.setFitMode(current.fitMode);
    requestAnimationFrame(() => controller.scrollToPage(page - 1));
  }, [controller]);

  if (initError) {
    return <Alert severity="warning">{ui("고성능 PDF 렌더러를 사용할 수 없습니다. 기본 뷰어로 전환합니다. (")}{initError})</Alert>;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {!uiHidden && (
        <ViewerToolbar controller={controller} state={state} currentPage={currentPage} pageInput={pageInput} inverted={inverted} bookmarkPanelOpen={bookmark.panelOpen} onPageInputChange={setPageInput} onSubmitPage={submitPageInput} onGoToPage={goToPage} onToggleInverted={onToggleInverted} onToggleBookmarks={() => bookmark.setPanelOpen((value) => !value)} onFitHeight={fitHeight} onPageLayoutChange={changePageLayout} onToggleContinuousScroll={toggleContinuousScroll} onToggleSpreadCover={() => selectSpreadCover(state.spreadPairing === 'alone' ? 'paired' : 'alone')} />
      )}

      <Box role="status" aria-label="viewer status" sx={{ position: 'absolute', width: '1px', height: '1px', minWidth: '1px', maxWidth: '1px', p: 0, m: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0, opacity: 0 }}>
        Backend: {state.backend} · Quality: {state.renderQuality} · Pages: {state.pageCount ? `${currentPage} / ${state.pageCount}` : '0 / 0'} · {displayLoadProgress}%
      </Box>
      {state.error ? <Alert severity="error">{state.error}</Alert> : null}
      {(state.loading || state.loadPhase === 'rendering') ? (
        <PdfLoadingProgress progress={displayLoadProgress} determinate={state.loadProgressDeterminate} />
      ) : null}
      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {bookmark.panelOpen && <BookmarkSidebar bookmarks={bookmarks} recentId={bookmark.recentId} deletingId={bookmark.deletingId} onEdit={bookmark.openEditor} onDelete={(id) => void bookmark.deleteItem(id)} onGoToPage={goToPage} />}
        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative' }}>
          <Box ref={surfaceWheelRef} data-testid="bookmark-capture-surface" sx={{ width: uiHidden ? '100%' : `calc(100% - ${ANNOTATION_RAIL_WIDTH}px)`, height: '100%', ml: uiHidden ? 0 : `${ANNOTATION_RAIL_WIDTH}px`, minWidth: 0, minHeight: 0, position: 'relative', touchAction: state.scrollMode === 'page' && (state.fitMode === 'page' || state.fitMode === 'height') ? 'none' : 'auto', cursor: annotation.tool === 'bookmark' && onBookmarkCaptured ? 'crosshair' : annotation.tool === 'select' ? pan.active ? 'grabbing' : 'grab' : 'default' }} onTouchStart={pageSwipe.touchStart} onTouchEnd={pageSwipe.touchEnd} onTouchCancel={pageSwipe.touchCancel} onPointerDown={annotation.tool === 'bookmark' ? bookmark.pointerDown : annotation.tool === 'select' ? pan.pointerDown : undefined} onPointerMove={annotation.tool === 'bookmark' ? bookmark.pointerMove : annotation.tool === 'select' ? pan.pointerMove : undefined} onPointerUp={annotation.tool === 'bookmark' ? (event) => void bookmark.pointerUp(event) : annotation.tool === 'select' ? pan.pointerUp : undefined} onPointerCancel={annotation.tool === 'bookmark' ? bookmark.cancelCapture : annotation.tool === 'select' ? pan.pointerCancel : undefined} onClickCapture={annotation.tool === 'bookmark' ? bookmark.suppressCaptureClick : undefined}>
            <Box ref={viewportRef} role="region" aria-label="PDF viewer" data-testid="pdfgpu-scroll-area" sx={{ width: '100%', height: '100%', overflow: 'auto', position: 'relative', bgcolor: (theme) => theme.palette.mode === 'light' ? '#e8decd' : '#3a3a3a', py: state.fitMode === 'height' || state.fitMode === 'page' ? 0 : 3, filter: inverted ? 'invert(1)' : 'none' }} />
            <AnnotationLayer controller={controller} annotations={annotation.annotations} visiblePages={annotationPageIndices} viewportElement={viewportRef.current} documentId={url} tool={annotation.tool} style={annotation.style} selectedId={annotation.selectedId} onSelect={annotation.setSelectedId} onChange={annotation.preview} onCommit={annotation.commit} />
            <BookmarkOverlayLayer overlays={overlayProjections} bookmarks={visibleOverlayBookmarks} recentId={bookmark.recentId} deletingId={bookmark.deletingId} captureDrag={bookmark.captureDrag} onDelete={(id) => void bookmark.deleteItem(id)} />
          </Box>
          {!uiHidden && <AnnotationControls tool={annotation.tool} style={annotation.displayedStyle} saveState={annotation.saveState} canUndo={annotation.canUndo} canRedo={annotation.canRedo} canRetry={annotation.canRetry} onToolChange={annotation.selectTool} onStyleChange={annotation.updateStyle} onUndo={annotation.undo} onRedo={annotation.redo} onRetry={annotation.retry} />}
        </Box>
      </Box>
      {(bookmark.captureBusy || bookmark.captureNotice) && <Box role={bookmark.captureNotice?.error ? 'alert' : 'status'} sx={{ position: 'fixed', right: 16, bottom: 16, zIndex: 20, px: 1.5, py: 0.75, borderRadius: 1, bgcolor: bookmark.captureNotice?.error ? 'rgba(127,29,29,.95)' : bookmark.captureNotice ? 'rgba(20,83,45,.95)' : 'rgba(30,30,30,.9)', color: 'grey.100', fontSize: 12 }}>{bookmark.captureNotice?.message ?? ui("북마크를 저장하는 중입니다…")}</Box>}
      <BookmarkEditorDialog bookmark={bookmark.editing} draft={bookmark.draft} onDraftChange={bookmark.setDraft} onClose={() => bookmark.setEditing(null)} onSave={() => void bookmark.saveEditor()} />
    </Box>
  );
}
