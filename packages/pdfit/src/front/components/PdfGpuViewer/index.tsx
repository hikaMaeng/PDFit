import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, Box, LinearProgress, Typography } from '@mui/material';
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
  viewerModeParts,
} from '@pdfgpu/core';
import { interpolatePdfGpuDisplayProgress } from './loadingProgress.js';
import { AnnotationLayer } from './AnnotationLayer.js';
import { usePdfAnnotations } from './usePdfAnnotations.js';
import { ViewerToolbar } from './ViewerToolbar.js';
import { BookmarkSidebar } from './BookmarkSidebar.js';
import { BookmarkEditorDialog } from './BookmarkEditorDialog.js';
import { BookmarkOverlayLayer } from './BookmarkOverlayLayer.js';
import { usePdfBookmarks } from './usePdfBookmarks.js';
import { AnnotationControls } from './AnnotationControls.js';
import { usePdfPan } from './usePdfPan.js';

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
  zoom: 1.2,
  pageCount: 0,
  provider: 'in-memory',
  engine: 'in-memory',
  viewMode: 'single',
  spreadPlacement: 'first-right',
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
  const viewportRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<PdfGpuViewerController | null>(null);
  const [controller, setController] = useState<PdfGpuViewerController | null>(null);
  const annotation = usePdfAnnotations(url);
  const bookmark = usePdfBookmarks({ enabled: annotation.tool === 'bookmark', controller, onCaptured: onBookmarkCaptured, onUpdated: onBookmarkUpdated, onDeleted: onBookmarkDeleted });
  const pan = usePdfPan(viewportRef, annotation.tool === 'select', () => annotation.setSelectedId(null));
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
    const target = normalizeViewerPage(page, state.pageCount, mode);
    controller?.scrollToPage(target - 1);
  }, [controller, state.pageCount, state.scrollMode, state.viewMode]);

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
          initialZoom: initialScale ?? 1.2,
          minZoom: 0.25,
          maxZoom: 5,
          viewMode: initialViewMode === 'double' ? 'spread' : 'single',
          fitMode: initialFitMode ?? 'none',
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
      fitMode: state.fitMode === 'page' ? 'none' : state.fitMode,
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
    const handleKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (!controller || !state.pageCount || tag === 'INPUT' || tag === 'TEXTAREA') return;
      const transition = reduceViewerInteraction(
        createViewerInteractionState({
          page: currentPage,
          pageCount: state.pageCount,
          mode: viewerModeFromParts(state.scrollMode, state.viewMode),
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
  }, [controller, currentPage, goToPage, state.pageCount, state.scrollMode, state.viewMode]);

  useEffect(() => {
    if (!controller || state.loadPhase !== 'ready') return;
    const applied = initialViewAppliedRef.current;
    if (applied?.controller === controller && applied.page === initialPage && applied.scrollTop === initialScrollTop) return;
    initialViewAppliedRef.current = { controller, page: initialPage, scrollTop: initialScrollTop };
    if (initialPage != null) goToPage(initialPage);
    if (initialScrollTop && initialScrollTop > 0 && viewportRef.current) {
      viewportRef.current.scrollTop = initialScrollTop;
    }
  }, [controller, goToPage, initialPage, initialScrollTop, state.loadPhase]);

  const submitPageInput = useCallback((value: string) => {
    const page = Number.parseInt(value, 10);
    if (Number.isFinite(page)) goToPage(page);
    else setPageInput(String(currentPage));
  }, [currentPage, goToPage]);

  const toggleViewMode = useCallback((next: 'scroll' | 'single' | 'double') => {
    if (!controller) return;
    const parts = viewerModeParts(next);
    controller.setScrollMode(parts.scrollMode);
    controller.setViewMode(parts.viewMode);
    // A scroll-mode-only transition does not rebuild @pdfgpu/core's layout.
    // Reapplying the current fit mode makes page positions match the new mode.
    controller.setFitMode(controller.getState().fitMode);
  }, [controller]);

  if (initError) {
    return <Alert severity="warning">고성능 PDF 렌더러를 사용할 수 없습니다. 기본 뷰어로 전환합니다. ({initError})</Alert>;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {!uiHidden && (
        <ViewerToolbar controller={controller} state={state} currentPage={currentPage} pageInput={pageInput} inverted={inverted} bookmarkPanelOpen={bookmark.panelOpen} onPageInputChange={setPageInput} onSubmitPage={submitPageInput} onGoToPage={goToPage} onToggleInverted={onToggleInverted} onToggleBookmarks={() => bookmark.setPanelOpen((value) => !value)} onViewModeChange={toggleViewMode} />
      )}

      <Box role="status" aria-label="viewer status" sx={{ position: 'absolute', width: '1px', height: '1px', minWidth: '1px', maxWidth: '1px', p: 0, m: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0, opacity: 0 }}>
        Backend: {state.backend} · Quality: {state.renderQuality} · Pages: {state.pageCount ? `${currentPage} / ${state.pageCount}` : '0 / 0'} · {displayLoadProgress}%
      </Box>
      {state.error ? <Alert severity="error">{state.error}</Alert> : null}
      {(state.loading || state.loadPhase === 'rendering') ? (
        <Box sx={{ position: 'absolute', zIndex: 4, top: 8, left: '50%', transform: 'translateX(-50%)', width: 'min(420px, 70vw)', px: 1.5, py: 1, bgcolor: 'rgba(20, 20, 20, 0.86)', borderRadius: 1 }}>
          <LinearProgress variant={state.loadProgressDeterminate ? 'determinate' : 'indeterminate'} value={displayLoadProgress} />
          <Typography data-testid="viewer-load-progress" variant="caption" sx={{ display: 'block', mt: 0.5, textAlign: 'center', color: 'grey.300' }}>{displayLoadProgress}%</Typography>
        </Box>
      ) : null}
      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {bookmark.panelOpen && <BookmarkSidebar bookmarks={bookmarks} recentId={bookmark.recentId} deletingId={bookmark.deletingId} onEdit={bookmark.openEditor} onDelete={(id) => void bookmark.deleteItem(id)} onGoToPage={goToPage} />}
        <Box data-testid="bookmark-capture-surface" sx={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative', cursor: annotation.tool === 'bookmark' && onBookmarkCaptured ? 'crosshair' : annotation.tool === 'select' ? pan.active ? 'grabbing' : 'grab' : 'default' }} onPointerDown={annotation.tool === 'bookmark' ? bookmark.pointerDown : annotation.tool === 'select' ? pan.pointerDown : undefined} onPointerMove={annotation.tool === 'bookmark' ? bookmark.pointerMove : annotation.tool === 'select' ? pan.pointerMove : undefined} onPointerUp={annotation.tool === 'bookmark' ? (event) => void bookmark.pointerUp(event) : annotation.tool === 'select' ? pan.pointerUp : undefined} onPointerCancel={annotation.tool === 'bookmark' ? bookmark.cancelCapture : annotation.tool === 'select' ? pan.pointerCancel : undefined} onWheel={annotation.tool === 'select' ? pan.wheel : undefined} onClickCapture={annotation.tool === 'bookmark' ? bookmark.suppressCaptureClick : undefined}>
          <Box ref={viewportRef} role="region" aria-label="PDF viewer" data-testid="pdfgpu-scroll-area" sx={{ width: '100%', height: '100%', overflow: 'auto', position: 'relative', bgcolor: '#3a3a3a', py: 3, filter: inverted ? 'invert(1)' : 'none' }} />
          {!uiHidden && <AnnotationControls tool={annotation.tool} style={annotation.displayedStyle} saveState={annotation.saveState} canUndo={annotation.canUndo} canRedo={annotation.canRedo} canRetry={annotation.canRetry} onToolChange={annotation.selectTool} onStyleChange={annotation.updateStyle} onUndo={annotation.undo} onRedo={annotation.redo} onRetry={annotation.retry} />}
          <AnnotationLayer controller={controller} annotations={annotation.annotations} visiblePages={state.visiblePages} viewportElement={viewportRef.current} documentId={url} tool={annotation.tool} style={annotation.style} selectedId={annotation.selectedId} onSelect={annotation.setSelectedId} onChange={annotation.preview} onCommit={annotation.commit} />
          <BookmarkOverlayLayer overlays={overlayProjections} bookmarks={visibleOverlayBookmarks} recentId={bookmark.recentId} deletingId={bookmark.deletingId} captureDrag={bookmark.captureDrag} onDelete={(id) => void bookmark.deleteItem(id)} />
        </Box>
      </Box>
      {(bookmark.captureBusy || bookmark.captureNotice) && <Box role={bookmark.captureNotice?.error ? 'alert' : 'status'} sx={{ position: 'fixed', right: 16, bottom: 16, zIndex: 20, px: 1.5, py: 0.75, borderRadius: 1, bgcolor: bookmark.captureNotice?.error ? 'rgba(127,29,29,.95)' : bookmark.captureNotice ? 'rgba(20,83,45,.95)' : 'rgba(30,30,30,.9)', color: 'grey.100', fontSize: 12 }}>{bookmark.captureNotice?.message ?? '북마크를 저장하는 중입니다…'}</Box>}
      <BookmarkEditorDialog bookmark={bookmark.editing} draft={bookmark.draft} onDraftChange={bookmark.setDraft} onClose={() => bookmark.setEditing(null)} onSave={() => void bookmark.saveEditor()} />
    </Box>
  );
}
