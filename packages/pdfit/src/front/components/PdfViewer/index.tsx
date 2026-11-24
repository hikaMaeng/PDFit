import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Box, Button, CircularProgress, Alert, Typography, IconButton } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PdfPage from './PdfPage';
import PdfOutlineDialog from './PdfOutlineDialog.js';
import { readPdfOutline, type PdfOutlineResult } from '../../viewer/pdfOutline.js';
import { isTransientPdfOpenError, openPdfWithRetry } from '../../viewer/pdfOpenRetry.js';
import type { BookstoreOutlineLookup } from '../../viewer/bookstoreOutline.js';
import type { PdfOutlineStorage } from '../../viewer/storedOutline.js';
import type { ViewerStatePayload } from '../../api/viewerState';
import {
  createViewerInteractionState,
  normalizeViewerPage,
  reduceViewerInteraction,
  type PdfGpuColorAdjustmentState,
  type PdfGpuColorAdjustments,
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
import { ViewerToolbar, ViewerToolbarFrame } from '../ViewerToolbar/index.js';
import { usePageColorFilter } from '../PageColorFilter.js';
import { useNonPassiveWheel } from '../useNonPassiveWheel.js';
import { usePageSwipe } from '../usePageSwipe.js';
import { LegacyAnnotationLayer } from './LegacyAnnotationLayer.js';
import { usePdfitI18n } from '../../i18n/usePdfitI18n.js';
import { DEFAULT_VIEWER_ZOOM, fitZoomForCssExtent, toPdfJsViewportScale } from './pdfDisplayScale.js';
import { RSC } from './resource.js';

const loadPdfJs = () => import('../../pdfjs.js').then(({ loadPdfJs: load }) => load());

const ZOOM_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0];
// Remote Drive PDFs have a meaningful round-trip cost per byte-range request.
// A 2 MiB range reduces sequential Drive round trips for ordinary documents
// without forcing the browser to fetch an entire large PDF before page one.
const REMOTE_PDF_RANGE_CHUNK_SIZE = 2 * 1024 * 1024;
/** Backoff before reopening a range-loaded document after a failed fetch: 1 s, 2 s, 4 s, then 8 s. */
const RECOVERY_BASE_MS = 1000;
const RECOVERY_MAX_MS = 8000;
const SINGLE_REQUEST_PDF_MAX_BYTES = 20 * 1024 * 1024;
const PAGE_HORIZONTAL_PADDING = 12;
type ViewMode = 'scroll' | 'single' | 'double';
type PageLayout = Exclude<ViewMode, 'scroll'>;
type PdfOpenFailure = { kind: 'temporary' } | { kind: 'missing' } | { kind: 'error'; message: string };
type FitMode = 'none' | 'width' | 'height';

/** @see docs/internals.md#remote-pdf-loading */
async function readSmallRemotePdf(url: string, signal: AbortSignal, onProgress: (loaded: number, total: number) => void): Promise<Uint8Array | null> {
  const target = new URL(url, window.location.href);
  const byId = /^\/api\/folders\/by-id\/[^/]+$/.test(target.pathname);
  const local = /^\/api\/folders\/[^/]+\/files\/[^/]+$/.test(target.pathname);
  if (target.origin !== window.location.origin || (!byId && !local)) return null;
  // Avoid opening a PDF.js worker while the server is already reporting an outage.
  const metadata = await fetch(target, { method: 'HEAD', cache: 'no-store', signal }).catch((cause) => {
    signal.throwIfAborted();
    throw Object.assign(new Error('PDF availability check failed.'), { status: 0, cause });
  });
  if (!metadata.ok) throw Object.assign(new Error(`PDF request failed (${metadata.status})`), { status: metadata.status });
  if (!byId) return null;
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
  colorAdjustments: PdfGpuColorAdjustmentState;
  onColorAdjustmentsChange: (adjustments: PdfGpuColorAdjustments) => void;
  initialScrollTop?: number;
  onPageChange?: (page: number) => void;
  /** 뷰어 내부 상태(page/scale/fitMode/viewMode/inverted/scrollTop) 변경 시 호출 */
  onStateChange?: (state: Omit<ViewerStatePayload, 'uiHidden'>) => void;
  /** 상위(PdfViewerPage)에서 스페이스바로 토글된 UI 숨김 상태 */
  uiHidden?: boolean;
  documentActions?: React.ReactNode;
  scanBook?: import('../../api/ocr.js').OcrScanBook;
  bookmarks?: BookmarkRecord[];
  onBookmarkCaptured?: (capture: PdfGpuCaptureResult) => Promise<BookmarkRecord | void>;
  onBookmarkDeleted?: (id: string) => Promise<void>;
  onDocumentUnavailable?: () => void;
  /** Stored table of contents for this book. Without it the outline is read from the PDF each time and not stored. */
  outlineStorage?: PdfOutlineStorage | null;
  outlineLookup?: BookstoreOutlineLookup;
}

export default function PdfViewer({
  url,
  initialPage,
  initialScale,
  initialFitMode,
  initialViewMode,
  colorAdjustments,
  onColorAdjustmentsChange,
  initialScrollTop,
  onPageChange,
  onStateChange,
  uiHidden = false,
  documentActions,
  scanBook,
  bookmarks = [],
  onBookmarkCaptured,
  onBookmarkDeleted,
  onDocumentUnavailable,
  outlineStorage,
  outlineLookup,
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
  const inverted = colorAdjustments.invert;
  const pageColors = usePageColorFilter(colorAdjustments);
  const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadProgressDeterminate, setLoadProgressDeterminate] = useState(false);
  const [error, setError] = useState<PdfOpenFailure | null>(null);
  const [waitingForPdf, setWaitingForPdf] = useState(false);
  const [loadRevision, setLoadRevision] = useState(0);
  // doc이 로드되고 첫 페이지가 준비된 상태 (스프레드 트리거용)
  const [docReady, setDocReady] = useState(false);
  const [bookmarkPanelOpen, setBookmarkPanelOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const captureStartRef = useRef<{ pageIndex: number; canvas: HTMLCanvasElement; x: number; y: number; clientX: number; clientY: number } | null>(null);
  const [captureDrag, setCaptureDrag] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureNotice, setCaptureNotice] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
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
  // Pages of the current PDFDocumentProxy. A render error from a page of a replaced document
  // (its worker is being destroyed) must not start another recovery. Reset on every (re)open.
  const currentDocPagesRef = useRef<WeakSet<PDFPageProxy>>(new WeakSet());
  const pdfjsLibRef = useRef<Awaited<ReturnType<typeof loadPdfJs>> | null>(null);
  const rangeLoadingRef = useRef(false);
  // Recovery after a failed range fetch. Key: this viewer; `generation` changes when the url
  // changes or the viewer unmounts, which cancels a pending reopen. One timer, one task at most.
  const recoveryRef = useRef<{ attempts: number; timer: ReturnType<typeof setTimeout> | null; busy: boolean; generation: number; task: { destroy: () => Promise<void> } | null }>(
    { attempts: 0, timer: null, busy: false, generation: 0, task: null },
  );
  const recoverDocumentRef = useRef<(() => void) | null>(null);
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
    inverted,
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
      let failed = false;
      for (const n of order) {
        if (token.cancelled) return;
        if (loadedRef.current.has(n)) continue;
        try {
          const page = await doc.getPage(n);
          if (token.cancelled) return;
          loadedRef.current.add(n);
          currentDocPagesRef.current.add(page);
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
          // 로드 실패한 페이지는 건너뛴다. 구간 로딩 문서는 실패한 구간을 다시 요청하지 않으므로
          // 한 바퀴가 끝나면 문서를 다시 연다(recoverDocument).
          failed = true;
        }
      }
      if (failed && !token.cancelled) recoverDocumentRef.current?.();
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
    setWaitingForPdf(false);
    setPages([]);
    setCurrentPage(1);
    setPageInput('1');
    currentPageRef.current = 1;
    interactionRef.current = reduceViewerInteraction(interactionRef.current, { type: 'setPage', page: 1 }).state;
    initialPageAppliedRef.current = false;
    loadedRef.current = new Set();
    currentDocPagesRef.current = new WeakSet();
    spreadTokenRef.current.cancelled = true;
    baseVpRef.current = null;
    rangeLoadingRef.current = false;
    const recovery = recoveryRef.current;
    recovery.generation += 1;
    recovery.attempts = 0;
    if (recovery.timer) clearTimeout(recovery.timer);
    recovery.timer = null;

    // 이전 doc 정리
    if (docRef.current) {
      docRef.current.cleanup().catch(() => {});
      docRef.current = null;
    }

    const open = async () => {
      try {
        const [pdfjsLib, smallPdf] = await Promise.all([
          loadPdfJs(),
          readSmallRemotePdf(url, downloadAbort.signal, (loaded, total) => {
            if (cancelled) return;
            setLoadProgressDeterminate(true);
            setLoadProgress(Math.min(100, Math.max(0, (loaded / total) * 100)));
          }),
        ]);
        downloadAbort.signal.throwIfAborted();
        setRangeLoading(!smallPdf);
        if (smallPdf) setLoadProgressDeterminate(false);
        rangeLoadingRef.current = !smallPdf;
        pdfjsLibRef.current = pdfjsLib;
        task = pdfjsLib.getDocument(smallPdf ? { data: smallPdf } : {
          url, rangeChunkSize: REMOTE_PDF_RANGE_CHUNK_SIZE, disableAutoFetch: true, disableStream: true,
        });
        task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
          if (cancelled || smallPdf || !Number.isFinite(total) || total <= 0) return;
          setLoadProgressDeterminate(true);
          setLoadProgress(Math.min(100, Math.max(0, (loaded / total) * 100)));
        };
        const doc = await task.promise;
        // Boot the viewer at the saved page before publishing the document as ready.
        const firstPageNumber = Math.max(1, Math.min(doc.numPages, initialPageRef.current ?? 1));
        const firstPage = await doc.getPage(firstPageNumber);
        return { doc, firstPage, firstPageNumber };
      } catch (failure) {
        const failedTask = task;
        task = null;
        void failedTask?.destroy().catch(() => {});
        throw failure;
      }
    };

    openPdfWithRetry(open, downloadAbort.signal, () => setWaitingForPdf(true))
      .then(({ doc, firstPage, firstPageNumber }) => {
        if (cancelled) return;
        docRef.current = doc;
        setTotalPages(doc.numPages);
        // 희소 배열로 초기화
        setPages(new Array(doc.numPages).fill(null));

        loadedRef.current.add(firstPageNumber);
        currentDocPagesRef.current.add(firstPage);
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
        setWaitingForPdf(false);
        setLoading(false);
        setDocReady(true); // → currentPage 스프레드 effect 트리거
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const status = (e as { status?: unknown } | null)?.status;
        if (status === 404 || status === 410) {
          setError({ kind: 'missing' });
          onDocumentUnavailable?.();
        } else {
          setError(isTransientPdfOpenError(e) ? { kind: 'temporary' } : { kind: 'error', message: String(e) });
        }
        setLoading(false);
      });

    return () => {
      cancelled = true;
      downloadAbort.abort();
      spreadTokenRef.current.cancelled = true;
      task?.destroy().catch(() => {});
      const current = recoveryRef.current;
      current.generation += 1;
      if (current.timer) clearTimeout(current.timer);
      current.timer = null;
      current.task?.destroy().catch(() => {});
      current.task = null;
    };
  }, [url, loadRevision]);

  // ── 일시적 로드 실패 복구 ────────────────────────────────────
  // 구간(range) 로딩 중 한 구간 요청이 실패하면(서버 재시작 중 502, 연결 끊김) PDF.js 는 그
  // 구간을 계속 "요청됨"으로 두고 다시 요청하지 않는다. 같은 문서 객체로는 그 페이지를
  // 영영 그릴 수 없으므로, 같은 주소로 문서를 새로 열어 바꿔 끼운다. 현재 페이지·배율·
  // 보기 방식은 유지하고, 페이지 객체만 새로 받는다. 실패하면 1·2·4·8초 간격으로 다시 연다.
  const recoverDocument = useCallback(() => {
    const recovery = recoveryRef.current;
    if (!rangeLoadingRef.current || recovery.busy || recovery.timer) return;
    const generation = recovery.generation;
    const delay = Math.min(RECOVERY_MAX_MS, RECOVERY_BASE_MS * 2 ** Math.min(recovery.attempts, 3));
    const retryLater = () => {
      recovery.busy = false;
      if (generation !== recovery.generation) return;
      recovery.attempts += 1;
      recoverDocumentRef.current?.();
    };
    recovery.timer = setTimeout(async () => {
      recovery.timer = null;
      const pdfjsLib = pdfjsLibRef.current;
      if (!pdfjsLib || generation !== recovery.generation) return;
      recovery.busy = true;
      // Probe with one byte before reopening: a PDF.js open against a server that still fails
      // leaves an uncaught ResponseException in its internals for every attempt.
      const reachable = await fetch(url, { headers: { Range: 'bytes=0-0' }, cache: 'no-store' })
        .then((response) => { void response.body?.cancel().catch(() => {}); return response.ok; })
        .catch(() => false);
      if (!reachable) { retryLater(); return; }
      if (generation !== recovery.generation) { recovery.busy = false; return; }
      const task = pdfjsLib.getDocument({ url, rangeChunkSize: REMOTE_PDF_RANGE_CHUNK_SIZE, disableAutoFetch: true, disableStream: true });
      const previousTask = recovery.task;
      recovery.task = task;
      task.promise.then((doc: PDFDocumentProxy) => {
        recovery.busy = false;
        if (generation !== recovery.generation) { void task.destroy().catch(() => {}); return; }
        const previous = docRef.current;
        docRef.current = doc;
        loadedRef.current = new Set();
        currentDocPagesRef.current = new WeakSet();
        recovery.attempts = 0;
        setPages(new Array(doc.numPages).fill(null));
        startSpread(currentPageRef.current);
        // The first document's task is destroyed with the url effect; a recovered one here.
        if (previousTask) void previousTask.destroy().catch(() => {});
        else void previous?.cleanup().catch(() => {});
      }).catch(() => {
        if (recovery.task === task) recovery.task = previousTask;
        void task.destroy().catch(() => {});
        retryLater();
      });
    }, delay);
  }, [startSpread, url]);
  recoverDocumentRef.current = recoverDocument;
  const handlePageRenderError = useCallback((page: PDFPageProxy) => {
    if (currentDocPagesRef.current.has(page)) recoverDocumentRef.current?.();
  }, []);

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

  // ── 목차 ──────────────────────────────────────────────────────
  const outlineDocument = docReady ? docRef.current : null;
  const readOutline = useCallback((): Promise<PdfOutlineResult> => {
    if (!outlineDocument) return Promise.resolve({ status: 'failed', reason: 'error' });
    return readPdfOutline(outlineDocument, outlineLookup);
  }, [outlineDocument, outlineLookup]);

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

  // Stable scrollbar space keeps the fitted page from resizing its own input.
  // See docs/internals.md#viewer-zoom-contract.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const viewport = baseVpRef.current;
    if (fitMode === 'none' || !docReady || !container || !viewport) return;

    let previousZoom: number | undefined;
    let restorePageFrame = 0;
    const updateFit = () => {
      const spread = pageLayout === 'double';
      const width = container.clientWidth - PAGE_HORIZONTAL_PADDING * 2 - (spread ? 16 : 0);
      const height = container.clientHeight - 48;
      if (width <= 0 || height <= 0) return;

      const widthZoom = fitZoomForCssExtent(width, viewport.width * (spread ? 2 : 1));
      const heightZoom = fitZoomForCssExtent(height, viewport.height);
      const zoom = fitMode === 'width' ? widthZoom : spread ? Math.min(heightZoom, widthZoom) : heightZoom;
      if (zoom === previousZoom) return;
      previousZoom = zoom;
      setScale(zoom);

      if (continuousScroll) {
        const page = currentPageRef.current;
        cancelAnimationFrame(restorePageFrame);
        restorePageFrame = requestAnimationFrame(() => {
          const anchor = pageRefs.current[page - 1];
          if (anchor) container.scrollTop += anchor.getBoundingClientRect().top - container.getBoundingClientRect().top;
        });
      }
    };
    updateFit();
    const observer = new ResizeObserver(updateFit);
    observer.observe(container, { box: 'border-box' });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(restorePageFrame);
    };
  }, [continuousScroll, docReady, fitMode, pageLayout]);

  // ── 뷰모드 변경 ──────────────────────────────────────────────
  const selectPageLayout = (next: PageLayout) => {
    const interactionMode: ViewMode = continuousScroll ? 'scroll' : next;
    interactionRef.current = reduceViewerInteraction(interactionRef.current, { type: 'setMode', mode: interactionMode }).state;
    setPageLayout(next);
    if (next === 'double') {
      goToPage(currentPageRef.current, interactionMode);
      setFitMode('width');
    }
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
  const handleViewerWheel = useCallback((event: WheelEvent) => {
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
  // Non-passive so page-mode wheel paging and wheel panning can stop the browser's scroll.
  const viewerWheelRef = useNonPassiveWheel<HTMLDivElement>(handleViewerWheel);
  const surfaceElementRef = useCallback((element: HTMLDivElement | null) => {
    surfaceRef.current = element;
    viewerWheelRef(element);
  }, [viewerWheelRef]);

  // ── 공통 props ────────────────────────────────────────────────
  const basePageProps = { scale, inverted, eager: true as const, noMargin: true as const, onRenderError: handlePageRenderError };

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
      <>
        {!uiHidden && documentActions && <ViewerToolbarFrame>{documentActions}</ViewerToolbarFrame>}
        <Box sx={{ position: 'relative', flex: 1, minHeight: 0 }}>
          <PdfLoadingProgress progress={loadProgress} determinate={loadProgressDeterminate && !rangeLoading && !waitingForPdf}
            label={waitingForPdf ? t(RSC.VIEWER_PDF_OPEN_RETRYING_STATUS) : rangeLoading ? ui('첫 페이지를 준비하고 있습니다…') : undefined} />
        </Box>
      </>
    );
  }

  if (error) {
    return <>
      {!uiHidden && documentActions && <ViewerToolbarFrame>{documentActions}</ViewerToolbarFrame>}
      <Box sx={{ p: 4 }}><Alert severity="error" action={error.kind === 'temporary' && <Button color="inherit" size="small" onClick={() => setLoadRevision((value) => value + 1)}>{t('retry')}</Button>}>
        {error.kind === 'temporary' ? t(RSC.VIEWER_PDF_OPEN_UNAVAILABLE_ALERT) : error.kind === 'missing' ? t('documentUnavailable') : error.message}
      </Alert></Box>
    </>;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', position: 'relative' }}>

      {/* ── 툴바 (UI 숨김 시 사라짐) ── */}
      {!uiHidden && (
        <ViewerToolbar
          pageLayout={pageLayout}
          coverAloneSelected={pageLayout === 'double' && !continuousScroll ? spreadCover === 'alone' : undefined}
          continuousScroll={continuousScroll}
          zoomInput={zoomInput}
          zoomOutDisabled={scale <= ZOOM_LEVELS[0]}
          zoomInDisabled={scale >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
          colorAdjustments={colorAdjustments}
          bookmarkPanelOpen={bookmarkPanelOpen}
          bookmarkToggleTestId="legacy-bookmark-sidebar-toggle"
          documentActions={documentActions}
          scanBook={scanBook}
          outlineOpen={outlineOpen}
          outlineDisabled={!docReady}
          pageInput={pageInput}
          pageCount={totalPages}
          previousDisabled={isPrevDisabled}
          nextDisabled={isNextDisabled}
          onPageLayoutChange={selectPageLayout}
          onToggleSpreadCover={() => selectSpreadCover(spreadCover === 'alone' ? 'paired' : 'alone')}
          onToggleContinuousScroll={toggleContinuousScroll}
          onFitWidth={() => setFitMode('width')}
          onFitHeight={() => setFitMode('height')}
          onZoomOut={zoomOut}
          onZoomIn={zoomIn}
          onZoomInputChange={setZoomInput}
          onSubmitZoom={submitZoom}
          onColorAdjustmentsChange={onColorAdjustmentsChange}
          onToggleBookmarks={() => setBookmarkPanelOpen((value) => !value)}
          onOpenOutline={() => setOutlineOpen(true)}
          onPrevious={prevPage}
          onNext={nextPage}
          onPageInputChange={setPageInput}
          onSubmitPage={(value) => {
            const page = Number.parseInt(value, 10);
            if (Number.isFinite(page)) goToPage(page);
          }}
        />
      )}

      {pageColors.definition}
      <Box
        ref={surfaceElementRef}
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
        sx={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative', touchAction: viewMode !== 'scroll' && fitMode === 'height' ? 'none' : 'auto', cursor: annotation.tool === 'bookmark' && onBookmarkCaptured ? 'crosshair' : annotation.tool === 'select' ? pan.active ? 'grabbing' : 'grab' : 'default', '& [data-pdf-page] > canvas': { filter: pageColors.filter } }}
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
        <Box ref={containerRef} data-testid="pdf-scroll-area" sx={{
          height: '100%', width: `calc(100% - ${viewerLeftInset}px)`, ml: `${viewerLeftInset}px`,
          overflow: continuousScroll ? 'auto' : 'hidden',
          scrollbarGutter: continuousScroll ? 'stable' : undefined,
          overflowX: continuousScroll && fitMode === 'height' ? 'scroll' : undefined,
          display: continuousScroll ? 'block' : 'flex', alignItems: 'center', justifyContent: 'center',
          bgcolor: (theme) => theme.palette.mode === 'light' ? '#e8decd' : '#3a3a3a',
          py: 3, px: `${PAGE_HORIZONTAL_PADDING}px`, boxSizing: 'border-box',
        }}>
          {pageLayout === 'single' ? pages.map((page, idx) => {
            const pn = idx + 1;
            return (
              <Box key={idx} sx={{ display: continuousScroll || pn === currentPage ? 'block' : 'none' }} ref={(el) => { pageRefs.current[idx] = el as HTMLDivElement | null; }} data-legacy-page-shell="true" data-page-index={idx}>
                {page ? (
                  <PdfPage
                    page={page} scale={scale} pageNumber={pn} inverted={inverted} eager={pn === currentPage} onRenderError={handlePageRenderError}
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
                    <PdfPage page={page} scale={scale} pageNumber={idx + 1} inverted={inverted} eager={idx === currentPage - 1 || idx === currentPage} onRenderError={handlePageRenderError} bookmarks={bookmarks.filter((bookmark) => bookmark.pageIndex === idx)} onBookmarkDeleted={onBookmarkDeleted} />
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
      <PdfOutlineDialog open={outlineOpen} readOutline={readOutline} storage={outlineStorage} pageCount={totalPages} currentPage={currentPage} onSelectPage={goToPage} onClose={() => setOutlineOpen(false)} />
    </Box>
  );
}
