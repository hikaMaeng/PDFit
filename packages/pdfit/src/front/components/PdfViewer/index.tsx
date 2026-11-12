import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  Box, CircularProgress, Alert, Typography,
  IconButton, Tooltip, Divider, TextField, ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import ViewStreamIcon from '@mui/icons-material/ViewStream';
import CropPortraitIcon from '@mui/icons-material/CropPortrait';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import AutoStoriesIcon from '@mui/icons-material/AutoStories';
import FitScreenIcon from '@mui/icons-material/FitScreen';
import HeightIcon from '@mui/icons-material/Height';
import InvertColorsIcon from '@mui/icons-material/InvertColors';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PdfPage from './PdfPage';
import type { ViewerStatePayload } from '../../api/viewerState';
import {
  createViewerInteractionState,
  normalizeViewerPage,
  reduceViewerInteraction,
} from '@pdfgpu/core';
import type { PdfJsModule } from '../../pdfjs.js';
import {
  lastSpreadLead,
  nextSpreadToggleMemory,
  readSpreadCoverPreference,
  spreadRowPages,
  spreadToggleTarget,
  writeSpreadCoverPreference,
  type SpreadCover,
  type SpreadToggleMemory,
} from '../../viewer/spreadPairing.js';
import type { PdfGpuCaptureResult } from '@pdfgpu/core';
import type { BookmarkRecord } from '../../../common/protocol/bookmarks/index.js';
import { ANNOTATION_RAIL_WIDTH, AnnotationControls } from '../PdfGpuViewer/AnnotationControls.js';
import { usePdfAnnotations } from '../PdfGpuViewer/usePdfAnnotations.js';
import { usePdfPan } from '../PdfGpuViewer/usePdfPan.js';
import { PdfLoadingProgress } from '../PdfLoadingProgress.js';
import { usePageSwipe } from '../usePageSwipe.js';
import { LegacyAnnotationLayer } from './LegacyAnnotationLayer.js';
import { usePdfitI18n } from '../../i18n/usePdfitI18n.js';
import { DEFAULT_VIEWER_ZOOM, fitZoomForCssExtent, toPdfJsViewportScale } from './pdfDisplayScale.js';

const loadPdfJs = () => import('../../pdfjs.js').then(({ loadPdfJs: load }) => load());

const ZOOM_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0];
// Remote Drive PDFs have a meaningful round-trip cost per byte-range request.
// A 2 MiB range reduces sequential Drive round trips for ordinary documents
// without forcing the browser to fetch an entire large PDF before page one.
const REMOTE_PDF_RANGE_CHUNK_SIZE = 2 * 1024 * 1024;
const SINGLE_REQUEST_PDF_MAX_BYTES = 20 * 1024 * 1024;
const PAGE_HORIZONTAL_PADDING = 12;
type ViewMode = 'scroll' | 'single' | 'double';
type PageLayout = Exclude<ViewMode, 'scroll'>;
type FitMode = 'none' | 'width' | 'height';

/** @see docs/internals.md#remote-pdf-loading */
async function readSmallRemotePdf(url: string, signal: AbortSignal, onProgress: (loaded: number, total: number) => void): Promise<Uint8Array | null> {
  const target = new URL(url, window.location.href);
  if (target.origin !== window.location.origin || !/^\/api\/folders\/by-id\/[^/]+$/.test(target.pathname)) return null;
  const metadata = await fetch(target, { method: 'HEAD', signal });
  if (!metadata.ok) throw Object.assign(new Error(`PDF request failed (${metadata.status})`), { status: metadata.status });
  const total = Number(metadata.headers.get('Content-Length'));
  if (!Number.isSafeInteger(total) || total <= 0 || total > SINGLE_REQUEST_PDF_MAX_BYTES) return null;

  const response = await fetch(target, { signal });
  if (!response.ok) throw Object.assign(new Error(`PDF request failed (${response.status})`), { status: response.status });
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    if (loaded > SINGLE_REQUEST_PDF_MAX_BYTES) throw new Error('PDF size changed while loading.');
    onProgress(loaded, total);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

// center 페이지를 기준으로 양쪽으로 퍼져나가는 순서 생성
// 예: center=5, total=8 → [5, 4, 6, 3, 7, 2, 8, 1]
function generateSpreadOrder(center: number, total: number): number[] {
  const order: number[] = [];
  if (center >= 1 && center <= total) order.push(center);
  for (let off = 1; order.length < total; off++) {
    const l = center - off;
    const r = center + off;
    if (l >= 1) order.push(l);
    if (r <= total) order.push(r);
    if (l < 1 && r > total) break;
  }
  return order;
}

interface Props {
  url: string;
  initialPage?: number | null;
  initialScale?: number;
  initialFitMode?: FitMode;
  initialViewMode?: ViewMode;
  initialInverted?: boolean;
  inverted?: boolean;
  onToggleInverted?: () => void;
  initialScrollTop?: number;
  onPageChange?: (page: number) => void;
  /** 뷰어 내부 상태(page/scale/fitMode/viewMode/inverted/scrollTop) 변경 시 호출 */
  onStateChange?: (state: Omit<ViewerStatePayload, 'uiHidden'>) => void;
  /** 상위(PdfViewerPage)에서 스페이스바로 토글된 UI 숨김 상태 */
  uiHidden?: boolean;
  bookmarks?: BookmarkRecord[];
  onBookmarkCaptured?: (capture: PdfGpuCaptureResult) => Promise<BookmarkRecord | void>;
  onBookmarkDeleted?: (id: string) => Promise<void>;
  onDocumentUnavailable?: () => void;
}

export default function PdfViewer({
  url,
  initialPage,
  initialScale,
  initialFitMode,
  initialViewMode,
  initialInverted,
  inverted: controlledInverted,
  onToggleInverted,
  initialScrollTop,
  onPageChange,
  onStateChange,
  uiHidden = false,
  bookmarks = [],
  onBookmarkCaptured,
  onBookmarkDeleted,
  onDocumentUnavailable,
}: Props) {
  const { t, ui } = usePdfitI18n();
  // pages: 희소 배열 (null = 아직 미로드)
  const [rangeLoading, setRangeLoading] = useState(false);
  const [pages, setPages] = useState<(PDFPageProxy | null)[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [scale, setScale] = useState(initialScale ?? DEFAULT_VIEWER_ZOOM);
  const [zoomInput, setZoomInput] = useState(String(Math.round((initialScale ?? DEFAULT_VIEWER_ZOOM) * 100)));
  const [fitMode, setFitMode] = useState<FitMode>(initialFitMode ?? 'none');
  const [pageLayout, setPageLayout] = useState<PageLayout>(initialViewMode === 'double' ? 'double' : 'single');
  const [continuousScroll, setContinuousScroll] = useState(initialViewMode === 'scroll');
  // Spread pairing is a reader choice, not a fixed rule: (1,2),(3,4) or cover alone (1),(2,3).
  const [spreadCover, setSpreadCover] = useState<SpreadCover>(() => readSpreadCoverPreference());
  const viewMode: ViewMode = continuousScroll ? 'scroll' : pageLayout;
  const [localInverted, setLocalInverted] = useState(initialInverted ?? false);
  const inverted = controlledInverted ?? localInverted;
  const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadProgressDeterminate, setLoadProgressDeterminate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // doc이 로드되고 첫 페이지가 준비된 상태 (스프레드 트리거용)
  const [docReady, setDocReady] = useState(false);
  const [bookmarkPanelOpen, setBookmarkPanelOpen] = useState(false);
  const captureStartRef = useRef<{ pageIndex: number; canvas: HTMLCanvasElement; x: number; y: number; clientX: number; clientY: number } | null>(null);
  const [captureDrag, setCaptureDrag] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureNotice, setCaptureNotice] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const initialPageAppliedRef = useRef(false);
  const initialPageRef = useRef(initialPage);
  const annotation = usePdfAnnotations(url);
  const pan = usePdfPan(containerRef, annotation.tool === 'select', () => annotation.setSelectedId(null));
  const annotationPageIndices = useMemo(() => {
    if (continuousScroll) return pages.map((_, pageIndex) => pageIndex);
    if (pageLayout === 'single') return [Math.max(0, currentPage - 1)];
    if (pageLayout === 'double') return spreadRowPages(currentPage, totalPages, spreadCover).map((page) => page - 1);
    return pages.map((_, pageIndex) => pageIndex);
  }, [continuousScroll, currentPage, pageLayout, pages, spreadCover, totalPages]);

  // 최신 상태를 이벤트 핸들러 내부에서 참조하기 위한 refs
  const currentPageRef = useRef(currentPage);
  const totalPagesRef = useRef(totalPages);
  const viewModeRef = useRef(viewMode);
  const pageLayoutRef = useRef(pageLayout);
  const spreadCoverRef = useRef(spreadCover);
  const interactionRef = useRef(createViewerInteractionState({ mode: viewMode, pairing: spreadCover }));
  const spreadToggleMemoryRef = useRef<SpreadToggleMemory>(null);
  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);
  useEffect(() => { totalPagesRef.current = totalPages; }, [totalPages]);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
  useEffect(() => { pageLayoutRef.current = pageLayout; }, [pageLayout]);
  useEffect(() => { spreadCoverRef.current = spreadCover; }, [spreadCover]);
  useEffect(() => { setZoomInput(String(Math.round(scale * 100))); }, [scale]);
  useEffect(() => {
    interactionRef.current = reduceViewerInteraction(interactionRef.current, {
      type: 'setPageCount',
      pageCount: totalPages,
    }).state;
  }, [totalPages]);

  // 스프레드 로딩 제어
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const loadedRef = useRef<Set<number>>(new Set());
  const spreadTokenRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  const spreadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 플레이스홀더 크기 계산용 (scale=1 기준 첫 페이지 뷰포트)
  const baseVpRef = useRef<{ width: number; height: number } | null>(null);

  // 상태 스냅샷 — 스크롤 핸들러 등 이벤트에서 최신 상태를 참조할 때 사용
  const stateSnapshotRef = useRef<Omit<ViewerStatePayload, 'uiHidden'>>({
    page: 1,
    scale: initialScale ?? DEFAULT_VIEWER_ZOOM,
    fitMode: initialFitMode ?? 'none',
    viewMode: initialViewMode ?? 'scroll',
    inverted: initialInverted ?? false,
    scrollTop: 0,
  });
  // 스크롤 복원 여부 플래그
  const scrollRestoredRef = useRef(false);

  // ── 스프레드 로딩 ─────────────────────────────────────────────
  // center 페이지를 기준으로 양쪽 퍼져나가며 미로드 페이지를 순차 로드
  const startSpread = useCallback((center: number) => {
    const doc = docRef.current;
    if (!doc) return;

    // 기존 스프레드 취소
    spreadTokenRef.current.cancelled = true;
    const token = { cancelled: false };
    spreadTokenRef.current = token;

    const order = generateSpreadOrder(center, doc.numPages);

    (async () => {
      for (const n of order) {
        if (token.cancelled) return;
        if (loadedRef.current.has(n)) continue;
        try {
          const page = await doc.getPage(n);
          if (token.cancelled) return;
          loadedRef.current.add(n);
          // 플레이스홀더 기준 크기 저장 (최초 1회)
          if (!baseVpRef.current) {
            const vp = page.getViewport({ scale: 1 });
            baseVpRef.current = { width: vp.width, height: vp.height };
          }
          setPages(prev => {
            if (prev[n - 1] !== null) return prev; // 이미 설정됨
            const next = [...prev];
            next[n - 1] = page;
            return next;
          });
        } catch {
          // 로드 실패한 페이지는 건너뜀
        }
      }
    })();
  }, []);

  // ── PDF 로드 ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<PdfJsModule['getDocument']> | null = null;
    const downloadAbort = new AbortController();
    setRangeLoading(false);
    setLoading(true);
    setLoadProgress(0);
    setLoadProgressDeterminate(false);
    setDocReady(false);
    setError(null);
    setPages([]);
    setCurrentPage(1);
    setPageInput('1');
    currentPageRef.current = 1;
    interactionRef.current = reduceViewerInteraction(interactionRef.current, { type: 'setPage', page: 1 }).state;
    initialPageAppliedRef.current = false;
    loadedRef.current = new Set();
    spreadTokenRef.current.cancelled = true;
    baseVpRef.current = null;

    // 이전 doc 정리
    if (docRef.current) {
      docRef.current.cleanup().catch(() => {});
      docRef.current = null;
    }

    Promise.all([
      loadPdfJs(),
      readSmallRemotePdf(url, downloadAbort.signal, (loaded, total) => {
        if (cancelled) return;
        setLoadProgressDeterminate(true);
        setLoadProgress(Math.min(100, Math.max(0, (loaded / total) * 100)));
      }).then((bytes) => { if (bytes && !cancelled) setLoadProgressDeterminate(false); return bytes; }),
    ])
      .then(([pdfjsLib, smallPdf]) => {
        if (cancelled) return null;
        setRangeLoading(!smallPdf);
        task = pdfjsLib.getDocument(smallPdf ? { data: smallPdf } : {
          url, rangeChunkSize: REMOTE_PDF_RANGE_CHUNK_SIZE, disableAutoFetch: true, disableStream: true,
        });
        task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
          if (cancelled || smallPdf || !Number.isFinite(total) || total <= 0) return;
          setLoadProgressDeterminate(true);
          setLoadProgress(Math.min(100, Math.max(0, (loaded / total) * 100)));
        };
        return task.promise;
      })
      .then(async (doc: PDFDocumentProxy | null) => {
        if (!doc) return;
        if (cancelled) { await doc.cleanup(); return; }
        docRef.current = doc;
        setTotalPages(doc.numPages);
        // 희소 배열로 초기화
        setPages(new Array(doc.numPages).fill(null));

        // 저장된 현재 페이지를 먼저 로드해 불필요한 1페이지 왕복을 피한다.
        const firstPageNumber = Math.max(1, Math.min(doc.numPages, initialPageRef.current ?? 1));
        const firstPage = await doc.getPage(firstPageNumber);
        if (cancelled) return;
        loadedRef.current.add(firstPageNumber);
        const vp = firstPage.getViewport({ scale: 1 });
        baseVpRef.current = { width: vp.width, height: vp.height };
        setPages(prev => {
          const next = [...prev];
          next[firstPageNumber - 1] = firstPage;
          return next;
        });
        currentPageRef.current = firstPageNumber;
        // 휠/키 입력은 interactionRef.page를 기준으로 다음 페이지를 계산한다.
        // 복원한 페이지를 여기서 동기화하지 않으면 첫 휠 이동이 1페이지 기준이 된다.
        interactionRef.current = reduceViewerInteraction(
          reduceViewerInteraction(interactionRef.current, { type: 'setPageCount', pageCount: doc.numPages }).state,
          { type: 'setPage', page: firstPageNumber },
        ).state;
        setCurrentPage(firstPageNumber);
        setPageInput(String(firstPageNumber));
        initialPageAppliedRef.current = initialPageRef.current != null;
        setLoadProgress(100);
        setLoading(false);
        setDocReady(true); // → currentPage 스프레드 effect 트리거
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const status = (e as { status?: unknown } | null)?.status;
        if (status === 404 || status === 410) {
          setError(t('documentUnavailable'));
          onDocumentUnavailable?.();
        } else setError(String(e));
        setLoading(false);
      });

    return () => {
      cancelled = true;
      downloadAbort.abort();
      spreadTokenRef.current.cancelled = true;
      task?.destroy().catch(() => {});
    };
  }, [url]);

  // ── 현재 페이지 기준 스프레드 트리거 ─────────────────────────
  // currentPage 변경 시 150ms 디바운스 후 스프레드 재시작
  useEffect(() => {
    if (!docReady) return;
    if (spreadTimerRef.current) clearTimeout(spreadTimerRef.current);
    spreadTimerRef.current = setTimeout(() => {
      startSpread(currentPage);
    }, 150);
    return () => {
      if (spreadTimerRef.current) clearTimeout(spreadTimerRef.current);
    };
  }, [currentPage, docReady, startSpread]);

  // ── goToPage (안정적인 ref 기반) ──────────────────────────────
  const goToPage = useCallback((n: number, mode?: ViewMode) => {
    const m = mode ?? viewModeRef.current;
    const total = totalPagesRef.current;
    interactionRef.current = reduceViewerInteraction(interactionRef.current, { type: 'setMode', mode: m }).state;
    // Spread rows follow the reader's pairing (ignored outside double mode).
    const target = normalizeViewerPage(n, total, m, spreadCoverRef.current);
    interactionRef.current = reduceViewerInteraction(interactionRef.current, { type: 'setPage', page: target }).state;
    currentPageRef.current = target;
    setCurrentPage(target);
    setPageInput(String(target));
    if (m === 'scroll') {
      pageRefs.current[target - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const prevPage = useCallback(() => {
    const m = viewModeRef.current;
    goToPage(m === 'double' ? currentPageRef.current - 2 : currentPageRef.current - 1);
  }, [goToPage]);

  const nextPage = useCallback(() => {
    const m = viewModeRef.current;
    goToPage(m === 'double' ? currentPageRef.current + 2 : currentPageRef.current + 1);
  }, [goToPage]);
  const selectSpreadCover = useCallback((next: SpreadCover) => {
    const current = currentPageRef.current;
    const target = spreadToggleTarget(spreadToggleMemoryRef.current, current);
    spreadToggleMemoryRef.current = nextSpreadToggleMemory(spreadToggleMemoryRef.current, current, totalPagesRef.current, next);
    spreadCoverRef.current = next;
    interactionRef.current = reduceViewerInteraction(interactionRef.current, { type: 'setPairing', pairing: next }).state;
    setSpreadCover(next);
    writeSpreadCoverPreference(next);
    if (viewModeRef.current === 'double') goToPage(target);
  }, [goToPage]);
  const pageSwipe = usePageSwipe(containerRef, viewMode !== 'scroll' && (annotation.tool === 'select' || annotation.tool === 'bookmark'), prevPage, nextPage, fitMode === 'height');

  // ── initialPage 적용 ─────────────────────────────────────────
  useEffect(() => {
    if (!docReady || initialPage == null || initialPage <= 1) return;
    if (initialPageAppliedRef.current) return;
    initialPageAppliedRef.current = true;
    // 해당 페이지로 이동 (currentPage 변경 → 스프레드 effect가 해당 페이지 기준으로 재시작)
    setTimeout(() => goToPage(initialPage), 50);
  }, [docReady, initialPage, goToPage]);

  // ── currentPage → 상위 알림 ───────────────────────────────────
  useEffect(() => {
    if (pages.length === 0) return;
    onPageChange?.(currentPage);
  }, [currentPage]); // eslint-disable-line

  // ── 상태 변경 → 스냅샷 갱신 + 상위 알림 ────────────────────────
  useEffect(() => {
    if (pages.length === 0) return;
    stateSnapshotRef.current = {
      ...stateSnapshotRef.current,
      page: currentPage,
      scale,
      fitMode,
      viewMode,
      inverted,
    };
    onStateChange?.(stateSnapshotRef.current);
  }, [currentPage, scale, fitMode, viewMode, inverted]); // eslint-disable-line

  // ── scroll 모드 — 스크롤 위치 + 현재 페이지 추적 ─────────────────
  // 현재 페이지 기준: 뷰포트 세로 중앙을 포함하는 페이지 (결정론적, 진동 없음)
  useEffect(() => {
    if (viewMode !== 'scroll') return;
    const container = containerRef.current;
    if (!container) return;

    const detectPage = () => {
      const cRect = container.getBoundingClientRect();
      const midY = cRect.height / 2;
      const refs = pageRefs.current;
      let found = -1;

      for (let i = 0; i < refs.length; i++) {
        const el = refs[i];
        if (!el) continue;
        const eRect = el.getBoundingClientRect();
        const top = eRect.top - cRect.top;
        const bottom = eRect.bottom - cRect.top;

        if (top <= midY && bottom > midY) {
          // 뷰포트 중앙이 이 페이지 안에 있음
          found = i + 1;
          break;
        }
        if (top > midY) {
          // 중앙이 이 페이지보다 위: 이전 페이지가 현재 페이지
          found = Math.max(1, i);
          break;
        }
      }

      // 모든 페이지가 중앙보다 위에 있으면 (맨 아래 스크롤) → 마지막 페이지
      if (found === -1) {
        for (let i = refs.length - 1; i >= 0; i--) {
          const el = refs[i];
          if (!el) continue;
          const top = el.getBoundingClientRect().top - cRect.top;
          if (top <= midY) { found = i + 1; break; }
        }
      }

      if (found !== -1 && found !== currentPageRef.current) {
        currentPageRef.current = found;
        interactionRef.current = reduceViewerInteraction(interactionRef.current, { type: 'setPage', page: found }).state;
        setCurrentPage(found);
        setPageInput(String(found));
      }
    };

    const onScroll = () => {
      stateSnapshotRef.current = { ...stateSnapshotRef.current, scrollTop: container.scrollTop };
      onStateChange?.(stateSnapshotRef.current);
      detectPage();
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }); // eslint-disable-line — containerRef.current 변경 감지를 위해 매 렌더 등록

  // ── scroll 위치 복원 (scroll 모드, 최초 1회) ────────────────────
  useEffect(() => {
    if (!docReady || viewMode !== 'scroll' || scrollRestoredRef.current) return;
    if (!initialScrollTop || initialScrollTop <= 0) {
      scrollRestoredRef.current = true;
      return;
    }
    const timer = setTimeout(() => {
      if (containerRef.current) {
        containerRef.current.scrollTop = initialScrollTop;
      }
      scrollRestoredRef.current = true;
    }, 300);
    return () => clearTimeout(timer);
  }, [docReady, viewMode, initialScrollTop]);

  // ── fit 스케일 계산 ──────────────────────────────────────────
  const calcScale = useCallback((fit: FitMode, layout: PageLayout): number => {
    const container = containerRef.current;
    const firstLoaded = pages.find(p => p !== null);
    if (!container || !firstLoaded) return DEFAULT_VIEWER_ZOOM;
    const vp = firstLoaded.getViewport({ scale: 1 });
    if (fit === 'width') {
      const avail = container.clientWidth - PAGE_HORIZONTAL_PADDING * 2;
      return layout === 'double'
        ? fitZoomForCssExtent(avail - 16, 2 * vp.width)
        : fitZoomForCssExtent(avail, vp.width);
    }
    if (fit === 'height') {
      const avail = container.clientHeight - 48;
      const heightScale = fitZoomForCssExtent(avail, vp.height);
      if (layout !== 'double') return heightScale;
      const widthScale = fitZoomForCssExtent(container.clientWidth - PAGE_HORIZONTAL_PADDING * 2 - 16, 2 * vp.width);
      return Math.min(heightScale, widthScale);
    }
    return scale;
  }, [pages, scale]);

  // fit 모드 또는 뷰 모드 변경 시 스케일 재계산
  useEffect(() => {
    if (fitMode === 'none' || pages.length === 0) return;
    setScale(calcScale(fitMode, pageLayout));
  }, [fitMode, pageLayout, pages]); // eslint-disable-line

  // 창 크기 변경 시 재계산
  useEffect(() => {
    if (fitMode === 'none') return;
    const handler = () => setScale(calcScale(fitMode, pageLayout));
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [fitMode, pageLayout, calcScale]);

  useEffect(() => {
    if (fitMode === 'none') return;
    const page = currentPageRef.current;
    const timer = requestAnimationFrame(() => {
      setScale(calcScale(fitMode, pageLayout));
      if (continuousScroll) {
        requestAnimationFrame(() => pageRefs.current[page - 1]?.scrollIntoView({ block: 'start' }));
      }
    });
    return () => cancelAnimationFrame(timer);
  }, [bookmarkPanelOpen, calcScale, continuousScroll, fitMode, pageLayout]);

  // ── 뷰모드 변경 ──────────────────────────────────────────────
  const selectPageLayout = (next: PageLayout) => {
    const interactionMode: ViewMode = continuousScroll ? 'scroll' : next;
    interactionRef.current = reduceViewerInteraction(interactionRef.current, { type: 'setMode', mode: interactionMode }).state;
    setPageLayout(next);
    if (next === 'double') {
      goToPage(currentPageRef.current, interactionMode);
      setFitMode('width');
      setTimeout(() => setScale(calcScale('width', next)), 0);
      return;
    }
    if (fitMode !== 'none') {
      setTimeout(() => setScale(calcScale(fitMode, next)), 0);
    }
  };
  const handlePageLayout = (_: React.MouseEvent, next: PageLayout | null) => {
    if (next) selectPageLayout(next);
  };
  useLayoutEffect(() => {
    if (!continuousScroll && containerRef.current) containerRef.current.scrollTop = 0;
  }, [continuousScroll]);

  const toggleContinuousScroll = () => {
    const next = !continuousScroll;
    const page = currentPageRef.current;
    const mode: ViewMode = next ? 'scroll' : pageLayoutRef.current;
    interactionRef.current = reduceViewerInteraction(interactionRef.current, { type: 'setMode', mode }).state;
    setContinuousScroll(next);
    requestAnimationFrame(() => requestAnimationFrame(() => goToPage(page, mode)));
  };

  // ── 줌 ───────────────────────────────────────────────────────
  const zoomIn = () => {
    setFitMode('none');
    setScale((s) => ZOOM_LEVELS.find((z) => z > s) ?? s);
  };
  const zoomOut = () => {
    setFitMode('none');
    setScale((s) => [...ZOOM_LEVELS].reverse().find((z) => z < s) ?? s);
  };
  const fitTo = (mode: Exclude<FitMode, 'none'>) => {
    setFitMode(mode);
    setTimeout(() => setScale(calcScale(mode, pageLayoutRef.current)), 0);
  };
  const submitZoom = () => {
    const percentage = Number.parseFloat(zoomInput.replace('%', '').trim());
    if (!Number.isFinite(percentage)) {
      setZoomInput(String(Math.round(scale * 100)));
      return;
    }
    setFitMode('none');
    setScale(Math.min(800, Math.max(25, percentage)) / 100);
  };

  const capturePoint = useCallback((clientX: number, clientY: number) => {
    const pageElement = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-pdf-page]');
    const canvas = pageElement?.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const rect = canvas.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    const pageNumber = Number(pageElement?.dataset.pageNumber);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) return null;
    return { pageIndex: pageNumber - 1, canvas, x: clientX - rect.left, y: clientY - rect.top, clientX, clientY };
  }, []);

  const handleCapturePointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!onBookmarkCaptured || captureBusy || event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest('button, input, textarea, select, [role="button"]')) return;
    const point = capturePoint(event.clientX, event.clientY);
    if (!point) return;
    captureStartRef.current = point;
    setCaptureDrag({ startX: event.clientX, startY: event.clientY, endX: event.clientX, endY: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [captureBusy, capturePoint, onBookmarkCaptured]);

  const handleCapturePointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!captureStartRef.current) return;
    setCaptureDrag((current) => current ? { ...current, endX: event.clientX, endY: event.clientY } : current);
  }, []);

  const handleCapturePointerUp = useCallback(async (event: React.PointerEvent<HTMLElement>) => {
    const start = captureStartRef.current;
    captureStartRef.current = null;
    setCaptureDrag(null);
    if (!start || !onBookmarkCaptured) return;
    const end = capturePoint(event.clientX, event.clientY);
    if (!end || end.canvas !== start.canvas || end.pageIndex !== start.pageIndex || Math.abs(end.x - start.x) < 8 || Math.abs(end.y - start.y) < 8) return;
    const canvasRect = start.canvas.getBoundingClientRect();
    const sourceScaleX = start.canvas.width / Math.max(1, canvasRect.width);
    const sourceScaleY = start.canvas.height / Math.max(1, canvasRect.height);
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    const crop = document.createElement('canvas');
    crop.width = Math.max(1, Math.round(width * sourceScaleX));
    crop.height = Math.max(1, Math.round(height * sourceScaleY));
    crop.getContext('2d')?.drawImage(start.canvas, x * sourceScaleX, y * sourceScaleY, width * sourceScaleX, height * sourceScaleY, 0, 0, crop.width, crop.height);
    const page = pages[start.pageIndex];
    if (!page) return;
    const baseViewport = page.getViewport({ scale: 1 });
    setCaptureBusy(true);
    setCaptureNotice(null);
    try {
      await onBookmarkCaptured({ pageIndex: start.pageIndex, rect: { x: x / canvasRect.width * baseViewport.width, y: y / canvasRect.height * baseViewport.height, width: width / canvasRect.width * baseViewport.width, height: height / canvasRect.height * baseViewport.height }, imageBase64: crop.toDataURL('image/png').split(',')[1] ?? '', mimeType: 'image/png', quality: 'high-resolution', dpi: Math.round(96 * sourceScaleX) });
      setCaptureNotice(ui("북마크가 저장되었습니다."));
    } catch (error) {
      setCaptureNotice(error instanceof Error ? error.message : ui("북마크를 저장하지 못했습니다."));
    } finally {
      setCaptureBusy(false);
      window.setTimeout(() => setCaptureNotice(null), 3000);
    }
  }, [capturePoint, onBookmarkCaptured, pages]);

  // ── 키보드 (화살표, PageUp/Down) ─────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const transition = reduceViewerInteraction(interactionRef.current, {
        type: 'key',
        key: e.key,
        editableTarget: false,
      });
      interactionRef.current = transition.state;
      if (transition.preventDefault) e.preventDefault();
      for (const effect of transition.effects) {
        if (effect.type === 'navigate') goToPage(effect.page);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goToPage]);

  // ── 마우스 휠: 교체되는 viewport와 상위 overlay를 함께 처리한다 ──
  const handleViewerWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const transition = reduceViewerInteraction(interactionRef.current, {
      type: 'wheel',
      deltaY: event.deltaY,
      ctrlKey: event.ctrlKey,
    });
    interactionRef.current = transition.state;
    if (transition.preventDefault) event.preventDefault();
    for (const effect of transition.effects) {
      if (effect.type === 'navigate') goToPage(effect.page);
      if (effect.type === 'zoom') {
        if (effect.direction === 'in') zoomIn();
        else zoomOut();
      }
    }
    if (interactionRef.current.mode === 'scroll' && !event.ctrlKey && annotation.tool === 'select') pan.wheel(event);
  }, [annotation.tool, goToPage, pan.wheel, zoomIn, zoomOut]);

  // ── 공통 props ────────────────────────────────────────────────
  const basePageProps = { scale, inverted, eager: true as const, noMargin: true as const };

  const isPrevDisabled = currentPage <= 1;
  const isNextDisabled = viewMode === 'double'
    ? currentPage >= lastSpreadLead(totalPages, spreadCover)
    : currentPage >= totalPages;
  const showSpreadRightPage = spreadRowPages(currentPage, totalPages, spreadCover).length === 2;

  // 플레이스홀더 크기 (scale 적용)
  const bv = baseVpRef.current;
  const viewportScale = toPdfJsViewportScale(scale);
  const phW = bv ? Math.round(bv.width * viewportScale) : Math.round(595 * viewportScale);
  const phH = bv ? Math.round(bv.height * viewportScale) : Math.round(842 * viewportScale);
  const viewerLeftInset = (uiHidden ? 0 : ANNOTATION_RAIL_WIDTH) + (bookmarkPanelOpen ? 220 : 0);

  if (loading) {
    return (
      <Box sx={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <PdfLoadingProgress progress={loadProgress} determinate={loadProgressDeterminate && !rangeLoading} label={rangeLoading ? ui('첫 페이지를 준비하고 있습니다…') : undefined} />
      </Box>
    );
  }

  if (error) {
    return <Box sx={{ p: 4 }}><Alert severity="error">{error}</Alert></Box>;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', position: 'relative' }}>

      {/* ── 툴바 (UI 숨김 시 사라짐) ── */}
      {!uiHidden && (
        <Box
          role="toolbar"
          aria-label="viewer controls"
          sx={{
            display: 'flex', alignItems: 'center', gap: 0.5,
            px: 2, py: 0.5,
            bgcolor: (theme) => theme.palette.mode === 'light' ? '#f5efe4' : 'background.paper',
            borderBottom: '1px solid', borderColor: 'divider',
            flexShrink: 0, position: 'relative', zIndex: 10, overflowX: 'auto',
          }}
        >
          {/* 페이지 레이아웃 */}
          <ToggleButtonGroup
            size="small" value={pageLayout} exclusive onChange={handlePageLayout}
            sx={{ '& .MuiToggleButton-root': { py: 0.25, px: 0.75, border: 'none' } }}
          >
            <ToggleButton value="single" aria-label={t('singlePage')}>
              <Tooltip title={t('singlePage')} arrow enterDelay={0} enterNextDelay={0}><CropPortraitIcon fontSize="small" /></Tooltip>
            </ToggleButton>
            <ToggleButton value="double" aria-label={t('doublePage')}>
              <Tooltip title={t('doublePage')} arrow enterDelay={0} enterNextDelay={0}><MenuBookIcon fontSize="small" /></Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>
          {pageLayout === 'double' && !continuousScroll && (
            <Tooltip title={t('coverAlone')} arrow enterDelay={0} enterNextDelay={0}>
              <ToggleButton
                value="cover-alone" selected={spreadCover === 'alone'} aria-label={t('coverAlone')} aria-pressed={spreadCover === 'alone'}
                data-testid="spread-cover-alone" onClick={() => selectSpreadCover(spreadCover === 'alone' ? 'paired' : 'alone')}
                sx={{ py: 0.25, px: 0.75, border: 'none' }}
              >
                <AutoStoriesIcon fontSize="small" />
              </ToggleButton>
            </Tooltip>
          )}

          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

          <Tooltip title={t('continuousScroll')} arrow enterDelay={0} enterNextDelay={0}>
            <ToggleButton value="scroll" selected={continuousScroll} aria-label={t('continuousScroll')} aria-pressed={continuousScroll} onClick={toggleContinuousScroll} sx={{ py: 0.25, px: 0.75, border: 'none' }}>
              <ViewStreamIcon fontSize="small" />
            </ToggleButton>
          </Tooltip>

          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

          <Tooltip title={t('fitWidth')} arrow enterDelay={0} enterNextDelay={0}>
            <IconButton size="small" aria-label={t('fitWidth')} onClick={() => fitTo('width')}>
              <FitScreenIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title={t('fitHeight')} arrow enterDelay={0} enterNextDelay={0}>
            <IconButton size="small" aria-label={t('fitHeight')} onClick={() => fitTo('height')}>
              <HeightIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title={t('zoomOut')} arrow enterDelay={0} enterNextDelay={0}>
            <span><IconButton size="small" onClick={zoomOut} disabled={scale <= ZOOM_LEVELS[0]}><ZoomOutIcon fontSize="small" /></IconButton></span>
          </Tooltip>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <TextField
              size="small"
              value={zoomInput}
              onChange={(event) => setZoomInput(event.target.value.replace(/[^0-9.]/g, ''))}
              onKeyDown={(event) => { if (event.key === 'Enter') (event.currentTarget.querySelector('input') as HTMLInputElement | null)?.blur(); }}
              onBlur={submitZoom}
              inputProps={{ inputMode: 'decimal', style: { textAlign: 'center', width: 38, padding: '2px 2px', fontSize: '0.8rem' }, 'aria-label': t('zoomPercentage') }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ ml: 0.25 }}>%</Typography>
          </Box>
          <Tooltip title={t('zoomIn')} arrow enterDelay={0} enterNextDelay={0}>
            <span><IconButton size="small" onClick={zoomIn} disabled={scale >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}><ZoomInIcon fontSize="small" /></IconButton></span>
          </Tooltip>

          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

          <Tooltip title={t('invertColors')} arrow enterDelay={0} enterNextDelay={0}>
            <IconButton size="small" onClick={onToggleInverted ?? (() => setLocalInverted((v) => !v))} color={inverted ? 'primary' : 'default'}>
              <InvertColorsIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title={bookmarkPanelOpen ? t('closeBookmarkSidebar') : t('openBookmarkSidebar')} arrow enterDelay={0} enterNextDelay={0}>
            <IconButton data-testid="legacy-bookmark-sidebar-toggle" aria-label={bookmarkPanelOpen ? t('closeBookmarkSidebar') : t('openBookmarkSidebar')} size="small" onClick={() => setBookmarkPanelOpen((value) => !value)} color={bookmarkPanelOpen ? 'primary' : 'default'}>
              <AttachFileIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Box sx={{ flex: 1 }} />

          <Tooltip title={`${t('previousPage')} (←/PageUp)`} arrow enterDelay={0} enterNextDelay={0}>
            <span><IconButton size="small" aria-label={t('previousPage')} onClick={prevPage} disabled={isPrevDisabled}><NavigateBeforeIcon fontSize="small" /></IconButton></span>
          </Tooltip>
          <Box data-testid="viewer-page-indicator" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <TextField
              size="small"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { const n = parseInt(pageInput, 10); if (!isNaN(n)) goToPage(n); } }}
              onBlur={() => { const n = parseInt(pageInput, 10); if (!isNaN(n)) goToPage(n); }}
              inputProps={{ style: { textAlign: 'center', width: 40, padding: '2px 4px', fontSize: '0.8rem' }, 'aria-label': t('pageNumber') }}
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: 1 } }}
            />
            <Typography variant="caption" color="text.secondary">/ {totalPages}</Typography>
          </Box>
          <Tooltip title={`${t('nextPage')} (→/PageDown)`} arrow enterDelay={0} enterNextDelay={0}>
            <span><IconButton size="small" aria-label={t('nextPage')} onClick={nextPage} disabled={isNextDisabled}><NavigateNextIcon fontSize="small" /></IconButton></span>
          </Tooltip>
        </Box>
      )}

      <Box
        ref={surfaceRef}
        data-testid="legacy-bookmark-capture-surface"
        onTouchStart={pageSwipe.touchStart}
        onTouchEnd={pageSwipe.touchEnd}
        onTouchCancel={pageSwipe.touchCancel}
        onPointerDown={(event) => {
          if (annotation.tool === 'bookmark') handleCapturePointerDown(event);
          else if (annotation.tool === 'select') pan.pointerDown(event);
        }}
        onPointerMove={annotation.tool === 'bookmark' ? handleCapturePointerMove : annotation.tool === 'select' ? pan.pointerMove : undefined}
        onPointerUp={(event) => {
          if (annotation.tool === 'bookmark') void handleCapturePointerUp(event);
          else if (annotation.tool === 'select') pan.pointerUp(event);
        }}
        onPointerCancel={(event) => {
          if (annotation.tool === 'bookmark') { captureStartRef.current = null; setCaptureDrag(null); }
          else if (annotation.tool === 'select') pan.pointerCancel(event);
        }}
        onWheel={handleViewerWheel}
        sx={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative', touchAction: viewMode !== 'scroll' && fitMode === 'height' ? 'none' : 'auto', cursor: annotation.tool === 'bookmark' && onBookmarkCaptured ? 'crosshair' : annotation.tool === 'select' ? pan.active ? 'grabbing' : 'grab' : 'default' }}
      >
      {!uiHidden && <AnnotationControls leftOffset={bookmarkPanelOpen ? 220 : 0} tool={annotation.tool} style={annotation.displayedStyle} saveState={annotation.saveState} canUndo={annotation.canUndo} canRedo={annotation.canRedo} canRetry={annotation.canRetry} onToolChange={annotation.selectTool} onStyleChange={annotation.updateStyle} onUndo={annotation.undo} onRedo={annotation.redo} onRetry={annotation.retry} />}
      <LegacyAnnotationLayer surfaceRef={surfaceRef} viewportRef={containerRef} pages={pages} visiblePages={annotationPageIndices} annotations={annotation.annotations} documentId={url} tool={annotation.tool} style={annotation.style} selectedId={annotation.selectedId} onSelect={annotation.setSelectedId} onChange={annotation.preview} onCommit={annotation.commit} />

      {bookmarkPanelOpen && (
        <Box component="aside" aria-label={t('bookBookmarks')} sx={{ position: 'absolute', zIndex: 8, top: 0, bottom: 0, left: 0, width: 220, overflowY: 'auto', bgcolor: (theme) => theme.palette.mode === 'light' ? '#f5efe4' : '#242426', borderRight: '1px solid', borderColor: (theme) => theme.palette.mode === 'light' ? theme.palette.divider : 'rgba(255,255,255,.08)', p: 1 }}>
          <Typography variant="caption" sx={{ display: 'block', color: (theme) => theme.palette.mode === 'light' ? theme.palette.text.secondary : theme.palette.grey[400], px: 0.5, pb: 0.75 }}>{t('bookBookmarks')}</Typography>
          {bookmarks.length === 0 ? <Typography variant="caption" sx={{ color: (theme) => theme.palette.mode === 'light' ? theme.palette.text.secondary : theme.palette.grey[600], px: 0.5 }}>{t('dragToCapture')}</Typography> : bookmarks.map((bookmark) => (
            <Box data-testid="legacy-bookmark-card" component="article" key={bookmark.id} sx={{ mb: 1, border: `2px solid ${bookmark.borderColor}`, borderRadius: 1, overflow: 'hidden', bgcolor: (theme) => theme.palette.mode === 'light' ? '#fff' : '#303034' }}>
              <Box sx={{ height: 92, position: 'relative', bgcolor: '#161618' }}>
                <Box component="img" src={bookmark.imageUrl} alt="" sx={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                {onBookmarkDeleted && <IconButton aria-label={ui("북마크 삭제")} size="small" color="error" onClick={() => void onBookmarkDeleted(bookmark.id)} sx={{ position: 'absolute', top: 2, right: 2, p: 0.25, bgcolor: 'rgba(10,10,12,.72)' }}><DeleteOutlineIcon sx={{ fontSize: 18 }} /></IconButton>}
              </Box>
              <Typography variant="caption" sx={{ display: 'block', px: 0.75, py: 0.5, color: (theme) => theme.palette.mode === 'light' ? theme.palette.text.primary : theme.palette.grey[200] }}>p. {bookmark.pageIndex + 1}</Typography>
            </Box>
          ))}
        </Box>
      )}

      {captureDrag && <Box data-testid="legacy-bookmark-drag-preview" sx={{ position: 'fixed', zIndex: 15, pointerEvents: 'none', left: Math.min(captureDrag.startX, captureDrag.endX), top: Math.min(captureDrag.startY, captureDrag.endY), width: Math.abs(captureDrag.endX - captureDrag.startX), height: Math.abs(captureDrag.endY - captureDrag.startY), border: '2px dashed #f59e0b', bgcolor: 'rgba(245,158,11,.18)' }} />}
      {(captureBusy || captureNotice) && <Box role="status" sx={{ position: 'fixed', right: 16, bottom: 16, zIndex: 20, px: 1.5, py: 0.75, borderRadius: 1, bgcolor: captureNotice?.includes('저장되었습니다') ? 'rgba(20,83,45,.95)' : captureNotice ? 'rgba(127,29,29,.95)' : 'rgba(30,30,30,.9)', color: 'grey.100', fontSize: 12 }}>{captureNotice ?? ui("북마크를 저장하는 중입니다…")}</Box>}

      {/* ── 스크롤 모드 ── */}
      {(continuousScroll || pageLayout === 'single') && (
        <Box ref={containerRef} data-testid="pdf-scroll-area" sx={{ height: '100%', width: `calc(100% - ${viewerLeftInset}px)`, ml: `${viewerLeftInset}px`, overflow: continuousScroll ? 'auto' : 'hidden', display: continuousScroll ? 'block' : 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: (theme) => theme.palette.mode === 'light' ? '#e8decd' : '#3a3a3a', py: 3, px: `${PAGE_HORIZONTAL_PADDING}px`, boxSizing: 'border-box' }}>
          {pageLayout === 'single' ? pages.map((page, idx) => {
            const pn = idx + 1;
            return (
              <Box key={idx} sx={{ display: continuousScroll || pn === currentPage ? 'block' : 'none' }} ref={(el) => { pageRefs.current[idx] = el as HTMLDivElement | null; }} data-legacy-page-shell="true" data-page-index={idx}>
                {page ? (
                  <PdfPage
                    page={page} scale={scale} pageNumber={pn} inverted={inverted} eager={pn === currentPage}
                    bookmarks={bookmarks.filter((bookmark) => bookmark.pageIndex === idx)} onBookmarkDeleted={onBookmarkDeleted}
                  />
                ) : (
                  /* 아직 로드되지 않은 페이지 플레이스홀더 — 스크롤 위치 유지 */
                  <Box
                    sx={{
                      width: phW, height: phH,
                      mx: 'auto', mb: 2,
                      bgcolor: '#fff',
                      boxShadow: (theme) => theme.palette.mode === 'light' ? '0 3px 16px rgba(32,78,121,.18)' : '0 4px 20px rgba(0,0,0,.6)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <CircularProgress size={20} sx={{ opacity: 0.4 }} />
                  </Box>
                )}
              </Box>
            );
          }) : Array.from({ length: Math.ceil(pages.length / 2) }, (_, rowIndex) => {
            const indices = [rowIndex * 2, rowIndex * 2 + 1].filter((index) => index < pages.length);
            return <Box key={rowIndex} sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 2, mb: 2 }}>
              {indices.map((idx) => {
                const page = pages[idx];
                return <Box key={idx} ref={(element) => { pageRefs.current[idx] = element as HTMLDivElement | null; }} data-legacy-page-shell="true" data-page-index={idx}>
                  {page ? (
                    <PdfPage page={page} scale={scale} pageNumber={idx + 1} inverted={inverted} eager={idx === currentPage - 1 || idx === currentPage} bookmarks={bookmarks.filter((bookmark) => bookmark.pageIndex === idx)} onBookmarkDeleted={onBookmarkDeleted} />
                  ) : (
                    <Box sx={{ width: phW, height: phH, bgcolor: '#fff', boxShadow: (theme) => theme.palette.mode === 'light' ? '0 3px 16px rgba(32,78,121,.18)' : '0 4px 20px rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <CircularProgress size={20} sx={{ opacity: 0.4 }} />
                    </Box>
                  )}
                </Box>;
              })}
            </Box>;
          })}
        </Box>
      )}

      {/* ── 두 페이지 모드 ── */}
      {!continuousScroll && pageLayout === 'double' && (
        <Box
          ref={containerRef} data-testid="pdf-scroll-area"
          sx={{ height: '100%', width: `calc(100% - ${viewerLeftInset}px)`, ml: `${viewerLeftInset}px`, overflow: 'hidden', bgcolor: (theme) => theme.palette.mode === 'light' ? '#e8decd' : '#3a3a3a', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, py: 3, px: `${PAGE_HORIZONTAL_PADDING}px`, boxSizing: 'border-box' }}
        >
          {/* 좌측 페이지 */}
          {pages[currentPage - 1] ? (
            <Box ref={(element) => { pageRefs.current[currentPage - 1] = element as HTMLDivElement | null; }} data-legacy-page-shell="true" data-page-index={currentPage - 1}>
              <PdfPage
                page={pages[currentPage - 1]!} pageNumber={currentPage} {...basePageProps}
                bookmarks={bookmarks.filter((bookmark) => bookmark.pageIndex === currentPage - 1)} onBookmarkDeleted={onBookmarkDeleted}
              />
            </Box>
          ) : (
            <Box
              sx={{
                width: phW, height: phH,
                bgcolor: '#fff', boxShadow: (theme) => theme.palette.mode === 'light' ? '0 3px 16px rgba(32,78,121,.18)' : '0 4px 20px rgba(0,0,0,.6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <CircularProgress size={28} />
            </Box>
          )}
          {/* 우측 페이지 */}
          {showSpreadRightPage && (
            pages[currentPage] ? (
              <Box ref={(element) => { pageRefs.current[currentPage] = element as HTMLDivElement | null; }} data-legacy-page-shell="true" data-page-index={currentPage}>
                <PdfPage
                  page={pages[currentPage]!} pageNumber={currentPage + 1} {...basePageProps}
                  bookmarks={bookmarks.filter((bookmark) => bookmark.pageIndex === currentPage)} onBookmarkDeleted={onBookmarkDeleted}
                />
              </Box>
            ) : (
              <Box
                sx={{
                  width: phW, height: phH,
                  bgcolor: '#fff', boxShadow: (theme) => theme.palette.mode === 'light' ? '0 3px 16px rgba(32,78,121,.18)' : '0 4px 20px rgba(0,0,0,.6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <CircularProgress size={28} />
              </Box>
            )
          )}
        </Box>
      )}

      </Box>
    </Box>
  );
}
