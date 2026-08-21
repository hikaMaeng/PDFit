import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  LinearProgress,
  Slider,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import ViewStreamIcon from '@mui/icons-material/ViewStream';
import CropPortraitIcon from '@mui/icons-material/CropPortrait';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import FitScreenIcon from '@mui/icons-material/FitScreen';
import HeightIcon from '@mui/icons-material/Height';
import InvertColorsIcon from '@mui/icons-material/InvertColors';
import BookmarksIcon from '@mui/icons-material/Bookmarks';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
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
import type { Annotation, AnnotationStyle, AnnotationTool } from '../../../common/protocol/annotations/index.js';
import { DEFAULT_ANNOTATION_STYLE } from '../../annotation/model.js';

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

const BOOKMARK_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#a855f7'];

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

function waitForCaptureDetail(controller: PdfGpuViewerController, timeoutMs = 12000): Promise<boolean> {
  if (controller.getState().renderQuality !== 'preview') return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.queueMicrotask(() => unsubscribe());
      resolve(ready);
    };
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    unsubscribe = controller.subscribe((nextState) => {
      if (nextState.renderQuality !== 'preview') finish(true);
    });
  });
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
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool>('bookmark');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [annotationStyle, setAnnotationStyle] = useState<AnnotationStyle>(DEFAULT_ANNOTATION_STYLE);
  const [initError, setInitError] = useState<string | null>(null);
  const [pageInput, setPageInput] = useState('1');
  const [bookmarkPanelOpen, setBookmarkPanelOpen] = useState(false);
  const captureStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressCaptureClickRef = useRef(false);
  const recentBookmarkTimerRef = useRef<number | null>(null);
  const captureNoticeTimerRef = useRef<number | null>(null);
  const [captureDrag, setCaptureDrag] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureNotice, setCaptureNotice] = useState<{ message: string; error: boolean } | null>(null);
  const [recentBookmarkId, setRecentBookmarkId] = useState<string | null>(null);
  const [editingBookmark, setEditingBookmark] = useState<BookmarkRecord | null>(null);
  const [bookmarkDraft, setBookmarkDraft] = useState<UpdateBookmarkRequest>({});
  const [deletingBookmarkId, setDeletingBookmarkId] = useState<string | null>(null);
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
  const selectedAnnotation = annotations.find((annotation) => annotation.id === selectedAnnotationId) ?? null;
  const displayedAnnotationStyle = selectedAnnotation?.style ?? annotationStyle;
  const updateAnnotationStyle = (patch: Partial<AnnotationStyle>) => {
    const next = { ...displayedAnnotationStyle, ...patch };
    setAnnotationStyle(next);
    if (selectedAnnotationId) setAnnotations((current) => current.map((annotation) => annotation.id === selectedAnnotationId ? { ...annotation, style: next, updatedAt: new Date().toISOString() } : annotation));
  };
  const selectAnnotationTool = (tool: AnnotationTool) => {
    setAnnotationTool(tool);
    setSelectedAnnotationId(null);
    if (tool === 'highlight') setAnnotationStyle({ color: '#facc15', opacity: 0.35, strokeWidth: 1, fillColor: null });
  };
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

  useEffect(() => () => {
    if (recentBookmarkTimerRef.current !== null) window.clearTimeout(recentBookmarkTimerRef.current);
    if (captureNoticeTimerRef.current !== null) window.clearTimeout(captureNoticeTimerRef.current);
  }, []);

  const showCaptureNotice = useCallback((message: string, error: boolean) => {
    if (captureNoticeTimerRef.current !== null) window.clearTimeout(captureNoticeTimerRef.current);
    setCaptureNotice({ message, error });
    captureNoticeTimerRef.current = window.setTimeout(() => {
      captureNoticeTimerRef.current = null;
      setCaptureNotice(null);
    }, error ? 4200 : 2200);
  }, []);

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

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!onBookmarkCaptured || captureBusy || event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest('button, input, textarea, select, [role="button"], [role="dialog"]')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const start = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    captureStartRef.current = start;
    setCaptureDrag({ start, end: start });
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [captureBusy, onBookmarkCaptured]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = captureStartRef.current;
    if (!start) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setCaptureDrag({ start, end: { x: event.clientX - rect.left, y: event.clientY - rect.top } });
  }, []);

  const handlePointerUp = useCallback(async (event: React.PointerEvent<HTMLDivElement>) => {
    const start = captureStartRef.current;
    captureStartRef.current = null;
    setCaptureDrag(null);
    if (!start || !controller) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const end = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (Math.abs(end.x - start.x) < 8 || Math.abs(end.y - start.y) < 8) return;
    suppressCaptureClickRef.current = true;
    setCaptureBusy(true);
    try {
      let capture: PdfGpuCaptureResult;
      try {
        capture = await controller.captureRegion(start, end, { minSize: 8 });
      } catch (error) {
        if ((error as { code?: string }).code !== 'high-resolution-not-ready' || !await waitForCaptureDetail(controller)) throw error;
        capture = await controller.captureRegion(start, end, { minSize: 8 });
      }
      const created = await onBookmarkCaptured?.(capture);
      if (created) {
        if (recentBookmarkTimerRef.current !== null) window.clearTimeout(recentBookmarkTimerRef.current);
        setRecentBookmarkId(created.id);
        recentBookmarkTimerRef.current = window.setTimeout(() => {
          recentBookmarkTimerRef.current = null;
          setRecentBookmarkId((current) => current === created.id ? null : current);
        }, 3200);
        showCaptureNotice('북마크가 저장되었습니다.', false);
      }
    } catch (error) {
      const code = (error as { code?: string }).code;
      const message = error instanceof Error ? error.message : 'Bookmark capture failed';
      const userMessage = code === 'capture-too-small'
        ? '북마크 영역을 조금 더 크게 드래그하세요.'
        : code === 'invalid-coordinates'
          ? '한 페이지 안에서 북마크 영역을 드래그하세요.'
          : code === 'high-resolution-not-ready' || message.includes('high-resolution')
            ? '고해상도 페이지를 불러오는 중입니다. 잠시 후 다시 시도하세요.'
            : `북마크를 저장하지 못했습니다. ${message}`;
      showCaptureNotice(userMessage, true);
    } finally {
      setCaptureBusy(false);
    }
  }, [controller, onBookmarkCaptured, showCaptureNotice]);

  const openBookmarkEditor = useCallback((bookmark: BookmarkRecord) => {
    setEditingBookmark(bookmark);
    setBookmarkDraft({ borderColor: bookmark.borderColor, fillColor: bookmark.fillColor, fillOpacity: bookmark.fillOpacity, comment: bookmark.comment });
  }, []);

  const saveBookmarkEditor = useCallback(async () => {
    if (!editingBookmark || !onBookmarkUpdated) return;
    await onBookmarkUpdated(editingBookmark.id, bookmarkDraft);
    setEditingBookmark(null);
  }, [bookmarkDraft, editingBookmark, onBookmarkUpdated]);

  const deleteBookmarkItem = useCallback(async (id: string) => {
    if (!onBookmarkDeleted || deletingBookmarkId) return;
    setDeletingBookmarkId(id);
    try {
      await onBookmarkDeleted(id);
    } finally {
      setDeletingBookmarkId(null);
    }
  }, [deletingBookmarkId, onBookmarkDeleted]);

  const toggleViewMode = useCallback((_event: React.MouseEvent<HTMLElement>, next: 'scroll' | 'single' | 'double' | null) => {
    if (!next || !controller) return;
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
        <Box
          role="toolbar"
          aria-label="viewer controls"
          sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 2, py: 0.5, bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0, overflowX: 'auto' }}
        >
          <Tooltip title="이전 페이지" arrow><span><IconButton size="small" aria-label="이전 페이지" title="이전 페이지" onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}><NavigateBeforeIcon fontSize="small" /></IconButton></span></Tooltip>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <TextField size="small" value={pageInput} onChange={(event) => setPageInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submitPageInput((event.target as HTMLInputElement).value); }} onBlur={(event) => submitPageInput((event.target as HTMLInputElement).value)} inputProps={{ style: { textAlign: 'center', width: 40, padding: '2px 4px', fontSize: '0.8rem' }, 'aria-label': 'page number' }} />
            <Typography variant="caption" color="text.secondary">/ {state.pageCount}</Typography>
          </Box>
          <Tooltip title="다음 페이지" arrow><span><IconButton size="small" aria-label="다음 페이지" title="다음 페이지" onClick={() => goToPage(currentPage + 1)} disabled={!state.pageCount || currentPage >= state.pageCount}><NavigateNextIcon fontSize="small" /></IconButton></span></Tooltip>
          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
          <Tooltip title="축소" arrow><span><IconButton size="small" onClick={() => controller?.zoomOut()}><ZoomOutIcon fontSize="small" /></IconButton></span></Tooltip>
          <Typography variant="caption" sx={{ minWidth: 40, textAlign: 'center', color: 'text.secondary' }}>{Math.round(state.zoom * 100)}%</Typography>
          <Tooltip title="확대" arrow><span><IconButton aria-label="확대" size="small" onClick={() => controller?.zoomIn()}><ZoomInIcon fontSize="small" /></IconButton></span></Tooltip>
          <Tooltip title="가로 너비 맞춤" arrow><IconButton size="small" onClick={() => controller?.fitWidth()} color={state.fitMode === 'width' ? 'primary' : 'default'}><FitScreenIcon fontSize="small" /></IconButton></Tooltip>
          <Tooltip title="세로 높이 맞춤" arrow><IconButton size="small" onClick={() => controller?.fitHeight()} color={state.fitMode === 'height' ? 'primary' : 'default'}><HeightIcon fontSize="small" /></IconButton></Tooltip>
          <Tooltip title="색상 반전" arrow><IconButton size="small" onClick={onToggleInverted} color={inverted ? 'primary' : 'default'}><InvertColorsIcon fontSize="small" /></IconButton></Tooltip>
          <Tooltip title={bookmarkPanelOpen ? '북마크 사이드바 닫기' : '북마크 사이드바 열기'} arrow><IconButton data-testid="bookmark-sidebar-toggle" aria-label={bookmarkPanelOpen ? '북마크 사이드바 닫기' : '북마크 사이드바 열기'} size="small" onClick={() => setBookmarkPanelOpen((value) => !value)} color={bookmarkPanelOpen ? 'primary' : 'default'}><BookmarksIcon fontSize="small" /></IconButton></Tooltip>
          <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem' }}>페이지 드래그: 북마크</Typography>
          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
          <ToggleButtonGroup size="small" value={state.scrollMode === 'continuous' ? 'scroll' : state.viewMode === 'spread' ? 'double' : 'single'} exclusive onChange={toggleViewMode} sx={{ '& .MuiToggleButton-root': { py: 0.25, px: 0.75, border: 'none' } }}>
            <ToggleButton value="scroll"><Tooltip title="연속 스크롤" arrow><ViewStreamIcon fontSize="small" /></Tooltip></ToggleButton>
            <ToggleButton value="single"><Tooltip title="한 페이지 보기" arrow><CropPortraitIcon fontSize="small" /></Tooltip></ToggleButton>
            <ToggleButton value="double"><Tooltip title="두 페이지 보기" arrow><MenuBookIcon fontSize="small" /></Tooltip></ToggleButton>
          </ToggleButtonGroup>
          <Box sx={{ flex: 1 }} />
          <ToggleButtonGroup size="small" exclusive value={annotationTool} onChange={(_, value: AnnotationTool | null) => { if (value) selectAnnotationTool(value); }} aria-label="annotation tools">
            {(['bookmark', 'select', 'highlight', 'text', 'pen', 'rectangle', 'circle', 'line', 'arrow'] as const).map((tool) => <ToggleButton key={tool} value={tool} aria-label={tool}>{tool}</ToggleButton>)}
          </ToggleButtonGroup>
          <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem' }}>Space: UI 숨기기</Typography>
          <Box component="label" aria-label="annotation color" title="선 색상" sx={{ display: 'inline-flex', alignItems: 'center' }}><Box component="input" type="color" value={displayedAnnotationStyle.color} onInput={(event) => updateAnnotationStyle({ color: (event.target as HTMLInputElement).value })} sx={{ width: 28, height: 24, p: 0, border: 0, bgcolor: 'transparent' }} /></Box>
          <Slider aria-label="annotation stroke width" title="선 두께" min={1} max={12} step={1} value={displayedAnnotationStyle.strokeWidth} onChange={(_, value) => updateAnnotationStyle({ strokeWidth: value as number })} sx={{ flex: '0 0 64px' }} />
          <Slider aria-label="annotation opacity" title="투명도" min={0.1} max={1} step={0.1} value={displayedAnnotationStyle.opacity} onChange={(_, value) => updateAnnotationStyle({ opacity: value as number })} sx={{ flex: '0 0 64px' }} />
          <FormControlLabel control={<Switch size="small" checked={displayedAnnotationStyle.fillColor !== null} onChange={(_, checked) => updateAnnotationStyle({ fillColor: checked ? displayedAnnotationStyle.color : null })} />} label="채움" sx={{ m: 0, '& .MuiFormControlLabel-label': { fontSize: '0.7rem' } }} />
          {displayedAnnotationStyle.fillColor !== null ? <Box component="label" aria-label="annotation fill color" title="채움 색상" sx={{ display: 'inline-flex', alignItems: 'center' }}><Box component="input" type="color" value={displayedAnnotationStyle.fillColor} onInput={(event) => updateAnnotationStyle({ fillColor: (event.target as HTMLInputElement).value })} sx={{ width: 28, height: 24, p: 0, border: 0, bgcolor: 'transparent' }} /></Box> : null}
        </Box>
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
        {bookmarkPanelOpen && (
          <Box component="aside" aria-label="Book bookmarks" sx={{ width: 220, flexShrink: 0, overflowY: 'auto', bgcolor: '#242426', borderRight: '1px solid rgba(255,255,255,.08)', p: 1 }}>
            <Typography variant="caption" sx={{ display: 'block', color: 'grey.400', px: 0.5, pb: 0.75 }}>Book bookmarks</Typography>
            {bookmarks.length === 0 ? <Typography variant="caption" color="grey.600" sx={{ px: 0.5 }}>Drag on a page to capture.</Typography> : bookmarks.map((bookmark) => (
              <Box data-testid="bookmark-card" component="article" role="button" tabIndex={0} key={bookmark.id} onClick={() => openBookmarkEditor(bookmark)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openBookmarkEditor(bookmark); } }} sx={{ display: 'block', width: '100%', mb: 1, p: 0, textAlign: 'left', cursor: 'pointer', border: `2px solid ${bookmark.borderColor}`, borderRadius: 1, overflow: 'hidden', bgcolor: '#303034' }}>
                <Box sx={{ height: 92, bgcolor: bookmark.fillColor ?? '#161618', position: 'relative' }}>
                  <Box component="img" src={bookmark.imageUrl} alt="" sx={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain', bgcolor: '#161618' }} />
                  {bookmark.fillColor && <Box sx={{ position: 'absolute', inset: 0, bgcolor: bookmark.fillColor, opacity: bookmark.fillOpacity, pointerEvents: 'none' }} />}
                  <IconButton data-testid="viewer-bookmark-card-delete" aria-label="북마크 삭제" title="북마크 삭제" size="small" color="error" disabled={deletingBookmarkId === bookmark.id} onClick={(event) => { event.stopPropagation(); void deleteBookmarkItem(bookmark.id); }} sx={{ position: 'absolute', top: 2, right: 2, p: 0.25, opacity: recentBookmarkId === bookmark.id ? 1 : 0.4, transform: recentBookmarkId === bookmark.id ? 'scale(1.08)' : 'scale(1)', transition: recentBookmarkId === bookmark.id ? 'none' : 'opacity 2.4s ease, transform 2.4s ease', bgcolor: 'rgba(10,10,12,.72)', '&:hover': { opacity: 0.9, bgcolor: 'rgba(10,10,12,.92)' } }}>
                    {deletingBookmarkId === bookmark.id ? <CircularProgress size={16} /> : <DeleteOutlineIcon sx={{ fontSize: 18 }} />}
                  </IconButton>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.75, py: 0.5 }}>
                  {bookmark.fillColor && <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: bookmark.fillColor, flexShrink: 0 }} />}
                  <Typography variant="caption" noWrap sx={{ flex: 1, color: 'grey.200' }}>p. {bookmark.pageIndex + 1}</Typography>
                  <Tooltip title="북마크 페이지로 이동" arrow>
                    <IconButton data-testid="bookmark-card-go-to-page" aria-label="북마크 페이지로 이동" size="small" onClick={(event) => { event.stopPropagation(); goToPage(bookmark.pageIndex + 1); }} sx={{ p: 0.25, color: 'grey.300', '&:hover': { color: 'primary.main', bgcolor: 'rgba(255,255,255,.08)' } }}>
                      <ArrowForwardIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                </Box>
                {bookmark.comment && <Typography variant="caption" noWrap sx={{ display: 'block', px: 0.75, pb: 0.5, color: 'grey.400' }}>{bookmark.comment}</Typography>}
              </Box>
            ))}
          </Box>
        )}
        <Box data-testid="bookmark-capture-surface" sx={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative', cursor: onBookmarkCaptured ? 'crosshair' : 'default' }} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={(event) => void handlePointerUp(event)} onPointerCancel={() => { captureStartRef.current = null; setCaptureDrag(null); }} onClickCapture={(event) => { if (!suppressCaptureClickRef.current) return; suppressCaptureClickRef.current = false; event.preventDefault(); event.stopPropagation(); }}>
          <Box ref={viewportRef} role="region" aria-label="PDF viewer" data-testid="pdfgpu-scroll-area" sx={{ width: '100%', height: '100%', overflow: 'auto', position: 'relative', bgcolor: '#3a3a3a', py: 3, px: 2, filter: inverted ? 'invert(1)' : 'none' }} />
          <AnnotationLayer controller={controller} annotations={annotations} visiblePages={state.visiblePages} viewportElement={viewportRef.current} documentId={url} tool={annotationTool} style={annotationStyle} selectedId={selectedAnnotationId} onSelect={setSelectedAnnotationId} onChange={setAnnotations} />
          <Box data-testid="bookmark-overlay-layer" sx={{ position: 'absolute', inset: 0, zIndex: 3, pointerEvents: 'none' }}>
            {overlayProjections.map((overlay, index) => {
              const bookmark = visibleOverlayBookmarks[index];
              return (
              <Tooltip key={`${overlay.pageIndex}-${index}`} title={overlay.comment ?? ''} disableHoverListener={!overlay.comment}>
                <Box data-testid="bookmark-page-overlay" sx={{ position: 'absolute', left: overlay.left, top: overlay.top, width: overlay.width, height: overlay.height, boxSizing: 'border-box', border: `2px solid ${overlay.borderColor}`, pointerEvents: bookmark ? 'auto' : overlay.comment ? 'auto' : 'none', zIndex: 2 }}>
                  {overlay.fillColor && <Box sx={{ position: 'absolute', inset: 0, bgcolor: overlay.fillColor, opacity: overlay.fillOpacity ?? 0.2, pointerEvents: 'none' }} />}
                  {bookmark && <IconButton data-testid="bookmark-overlay-delete" aria-label="북마크 삭제" title="북마크 삭제" size="small" color="error" disabled={deletingBookmarkId === bookmark.id} onClick={(event) => { event.stopPropagation(); void deleteBookmarkItem(bookmark.id); }} sx={{ position: 'absolute', top: 2, right: 2, p: 0.2, opacity: recentBookmarkId === bookmark.id ? 1 : 0.4, transform: recentBookmarkId === bookmark.id ? 'scale(1.12)' : 'scale(1)', transformOrigin: 'top right', transition: recentBookmarkId === bookmark.id ? 'none' : 'opacity 2.4s ease, transform 2.4s ease', bgcolor: 'rgba(10,10,12,.55)', zIndex: 3, '&:hover': { opacity: 0.9, bgcolor: 'rgba(10,10,12,.82)' } }}>
                    {deletingBookmarkId === bookmark.id ? <CircularProgress size={16} /> : <DeleteOutlineIcon sx={{ fontSize: 18 }} />}
                  </IconButton>}
                </Box>
              </Tooltip>
            );
            })}
            {captureDrag && <Box data-testid="bookmark-drag-preview" sx={{ position: 'absolute', left: Math.min(captureDrag.start.x, captureDrag.end.x), top: Math.min(captureDrag.start.y, captureDrag.end.y), width: Math.abs(captureDrag.end.x - captureDrag.start.x), height: Math.abs(captureDrag.end.y - captureDrag.start.y), boxSizing: 'border-box', border: '2px dashed #f59e0b', bgcolor: 'rgba(245, 158, 11, 0.18)' }} />}
          </Box>
        </Box>
      </Box>
      {(captureBusy || captureNotice) && <Box role={captureNotice?.error ? 'alert' : 'status'} sx={{ position: 'fixed', right: 16, bottom: 16, zIndex: 20, px: 1.5, py: 0.75, borderRadius: 1, bgcolor: captureNotice?.error ? 'rgba(127,29,29,.95)' : captureNotice ? 'rgba(20,83,45,.95)' : 'rgba(30,30,30,.9)', color: 'grey.100', fontSize: 12 }}>{captureNotice?.message ?? '북마크를 저장하는 중입니다…'}</Box>}
      <Dialog data-testid="bookmark-editor" open={Boolean(editingBookmark)} onClose={() => setEditingBookmark(null)} fullWidth maxWidth="xs">
        <DialogTitle>북마크 수정</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 2 }}>
          <Box>
            <Typography variant="body2" sx={{ mb: 1 }}>외곽선 색상</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>{BOOKMARK_COLORS.map((color) => <Box data-testid={`bookmark-border-color-${color.slice(1)}`} component="button" type="button" key={color} onClick={() => setBookmarkDraft((draft) => ({ ...draft, borderColor: color }))} sx={{ width: 26, height: 26, borderRadius: '50%', border: bookmarkDraft.borderColor === color ? '3px solid #111' : '1px solid #ddd', bgcolor: color, cursor: 'pointer' }} />)}</Box>
          </Box>
          <FormControlLabel control={<Switch checked={Boolean(bookmarkDraft.fillColor)} onChange={(_, checked) => setBookmarkDraft((draft) => ({ ...draft, fillColor: checked ? draft.fillColor ?? '#f59e0b' : null }))} />} label="내부 칠색상" />
          {bookmarkDraft.fillColor && <Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1 }}>{BOOKMARK_COLORS.map((color) => <Box data-testid={`bookmark-fill-color-${color.slice(1)}`} component="button" type="button" key={color} onClick={() => setBookmarkDraft((draft) => ({ ...draft, fillColor: color }))} sx={{ width: 26, height: 26, borderRadius: '50%', border: bookmarkDraft.fillColor === color ? '3px solid #111' : '1px solid #ddd', bgcolor: color, cursor: 'pointer' }} />)}</Box>
            <Typography variant="body2">칠 투명도</Typography>
            <Slider value={bookmarkDraft.fillOpacity ?? 0.2} min={0} max={1} step={0.05} valueLabelDisplay="auto" onChange={(_, value) => setBookmarkDraft((draft) => ({ ...draft, fillOpacity: value as number }))} />
          </Box>}
          <TextField label="코멘트" value={bookmarkDraft.comment ?? ''} onChange={(event) => setBookmarkDraft((draft) => ({ ...draft, comment: event.target.value || null }))} multiline minRows={3} />
        </DialogContent>
        <DialogActions><Button onClick={() => setEditingBookmark(null)}>취소</Button><Button variant="contained" onClick={() => void saveBookmarkEditor()}>저장</Button></DialogActions>
      </Dialog>
    </Box>
  );
}
