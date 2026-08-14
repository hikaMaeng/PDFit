import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import FitScreenIcon from '@mui/icons-material/FitScreen';
import HeightIcon from '@mui/icons-material/Height';
import InvertColorsIcon from '@mui/icons-material/InvertColors';
import PdfPage from './PdfPage';
import type { ViewerStatePayload } from '../../api/viewerState';
import {
  createViewerInteractionState,
  normalizeViewerPage,
  reduceViewerInteraction,
} from '@pdfgpu/core';
import type { PdfJsModule } from '../../pdfjs.js';

const loadPdfJs = () => import('../../pdfjs.js').then(({ loadPdfJs: load }) => load());

const ZOOM_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0];
type ViewMode = 'scroll' | 'single' | 'double';
type FitMode = 'none' | 'width' | 'height';

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
}: Props) {
  // pages: 희소 배열 (null = 아직 미로드)
  const [pages, setPages] = useState<(PDFPageProxy | null)[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [scale, setScale] = useState(initialScale ?? 1.2);
  const [fitMode, setFitMode] = useState<FitMode>(initialFitMode ?? 'width');
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode ?? 'scroll');
  const [localInverted, setLocalInverted] = useState(initialInverted ?? false);
  const inverted = controlledInverted ?? localInverted;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // doc이 로드되고 첫 페이지가 준비된 상태 (스프레드 트리거용)
  const [docReady, setDocReady] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const initialPageAppliedRef = useRef(false);

  // 최신 상태를 이벤트 핸들러 내부에서 참조하기 위한 refs
  const currentPageRef = useRef(currentPage);
  const totalPagesRef = useRef(totalPages);
  const viewModeRef = useRef(viewMode);
  const interactionRef = useRef(createViewerInteractionState({ mode: viewMode }));
  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);
  useEffect(() => { totalPagesRef.current = totalPages; }, [totalPages]);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
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
    scale: initialScale ?? 1.2,
    fitMode: initialFitMode ?? 'width',
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
    setLoading(true);
    setDocReady(false);
    setError(null);
    setPages([]);
    setCurrentPage(1);
    setPageInput('1');
    initialPageAppliedRef.current = false;
    loadedRef.current = new Set();
    spreadTokenRef.current.cancelled = true;
    baseVpRef.current = null;

    // 이전 doc 정리
    if (docRef.current) {
      docRef.current.cleanup().catch(() => {});
      docRef.current = null;
    }

    loadPdfJs()
      .then((pdfjsLib) => {
        if (cancelled) return null;
        task = pdfjsLib.getDocument({ url });
        return task.promise;
      })
      .then(async (doc: PDFDocumentProxy | null) => {
        if (!doc) return;
        if (cancelled) { await doc.cleanup(); return; }
        docRef.current = doc;
        setTotalPages(doc.numPages);
        // 희소 배열로 초기화
        setPages(new Array(doc.numPages).fill(null));

        // 1페이지를 먼저 로드해 뷰어를 즉시 표시
        const firstPage = await doc.getPage(1);
        if (cancelled) return;
        loadedRef.current.add(1);
        const vp = firstPage.getViewport({ scale: 1 });
        baseVpRef.current = { width: vp.width, height: vp.height };
        setPages(prev => {
          const next = [...prev];
          next[0] = firstPage;
          return next;
        });
        setLoading(false);
        setDocReady(true); // → currentPage 스프레드 effect 트리거
      })
      .catch((e: unknown) => {
        if (!cancelled) { setError(String(e)); setLoading(false); }
      });

    return () => {
      cancelled = true;
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
    const target = normalizeViewerPage(n, total, m);
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
  const calcScale = useCallback((fit: FitMode, mode: ViewMode): number => {
    const container = containerRef.current;
    const firstLoaded = pages.find(p => p !== null);
    if (!container || !firstLoaded) return 1.2;
    const vp = firstLoaded.getViewport({ scale: 1 });
    if (fit === 'width') {
      const avail = container.clientWidth - 48;
      return mode === 'double' ? (avail - 16) / (2 * vp.width) : avail / vp.width;
    }
    if (fit === 'height') {
      const avail = container.clientHeight - 48;
      return avail / vp.height;
    }
    return scale;
  }, [pages, scale]);

  // fit 모드 또는 뷰 모드 변경 시 스케일 재계산
  useEffect(() => {
    if (fitMode === 'none' || pages.length === 0) return;
    setScale(calcScale(fitMode, viewMode));
  }, [fitMode, viewMode, pages]); // eslint-disable-line

  // 창 크기 변경 시 재계산
  useEffect(() => {
    if (fitMode === 'none') return;
    const handler = () => setScale(calcScale(fitMode, viewMode));
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [fitMode, viewMode, calcScale]);

  // ── 뷰모드 변경 ──────────────────────────────────────────────
  const handleViewMode = (_: React.MouseEvent, next: ViewMode | null) => {
    if (!next) return;
    interactionRef.current = reduceViewerInteraction(interactionRef.current, { type: 'setMode', mode: next }).state;
    setViewMode(next);
    if (next === 'double') {
      const odd = currentPageRef.current % 2 === 0
        ? currentPageRef.current - 1
        : currentPageRef.current;
      goToPage(odd, next);
    }
    if (fitMode !== 'none') {
      setTimeout(() => setScale(calcScale(fitMode, next)), 0);
    }
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
  const toggleFit = (mode: FitMode) => {
    setFitMode((prev) => {
      const next = prev === mode ? 'none' : mode;
      if (next !== 'none') setTimeout(() => setScale(calcScale(next, viewModeRef.current)), 0);
      return next;
    });
  };

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

  // ── 마우스 휠: 모드별 소비 정책은 공통 순수 모델이 결정한다 ────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      const transition = reduceViewerInteraction(interactionRef.current, {
        type: 'wheel',
        deltaY: e.deltaY,
        ctrlKey: e.ctrlKey,
      });
      interactionRef.current = transition.state;
      if (transition.preventDefault) e.preventDefault();
      for (const effect of transition.effects) {
        if (effect.type === 'navigate') goToPage(effect.page);
        if (effect.type === 'zoom') {
          if (effect.direction === 'in') zoomIn();
          else zoomOut();
        }
      }
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [goToPage]);

  // ── 공통 props ────────────────────────────────────────────────
  const basePageProps = { scale, inverted, eager: true as const, noMargin: true as const };

  const isPrevDisabled = currentPage <= 1;
  const isNextDisabled = viewMode === 'double'
    ? currentPage + 1 >= totalPages
    : currentPage >= totalPages;

  // 플레이스홀더 크기 (scale 적용)
  const bv = baseVpRef.current;
  const phW = bv ? Math.floor(bv.width * scale) : Math.floor(595 * scale);
  const phH = bv ? Math.floor(bv.height * scale) : Math.floor(842 * scale);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 2 }}>
        <CircularProgress />
        <Typography color="text.secondary">PDF 로딩 중...</Typography>
      </Box>
    );
  }

  if (error) {
    return <Box sx={{ p: 4 }}><Alert severity="error">{error}</Alert></Box>;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>

      {/* ── 툴바 (UI 숨김 시 사라짐) ── */}
      {!uiHidden && (
        <Box
          sx={{
            display: 'flex', alignItems: 'center', gap: 0.5,
            px: 2, py: 0.5,
            bgcolor: 'background.paper',
            borderBottom: '1px solid', borderColor: 'divider',
            flexShrink: 0,
          }}
        >
          {/* 페이지 네비게이션 */}
          <Tooltip title="이전 페이지 (←/PageUp)" arrow enterDelay={0} enterNextDelay={0}>
            <span>
              <IconButton size="small" onClick={prevPage} disabled={isPrevDisabled}>
                <NavigateBeforeIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <TextField
              size="small"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { const n = parseInt(pageInput, 10); if (!isNaN(n)) goToPage(n); } }}
              onBlur={() => { const n = parseInt(pageInput, 10); if (!isNaN(n)) goToPage(n); }}
              inputProps={{ style: { textAlign: 'center', width: 40, padding: '2px 4px', fontSize: '0.8rem' } }}
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: 1 } }}
            />
            <Typography variant="caption" color="text.secondary">/ {totalPages}</Typography>
          </Box>

          <Tooltip title="다음 페이지 (→/PageDown)" arrow enterDelay={0} enterNextDelay={0}>
            <span>
              <IconButton size="small" onClick={nextPage} disabled={isNextDisabled}>
                <NavigateNextIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>

          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

          {/* 줌 */}
          <Tooltip title="축소" arrow enterDelay={0} enterNextDelay={0}>
            <span>
              <IconButton size="small" onClick={zoomOut} disabled={scale <= ZOOM_LEVELS[0]}>
                <ZoomOutIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Typography variant="caption" sx={{ minWidth: 40, textAlign: 'center', color: 'text.secondary' }}>
            {Math.round(scale * 100)}%
          </Typography>
          <Tooltip title="확대" arrow enterDelay={0} enterNextDelay={0}>
            <span>
              <IconButton size="small" onClick={zoomIn} disabled={scale >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}>
                <ZoomInIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>

          {/* 가로 맞춤 */}
          <Tooltip title="가로 너비 맞춤" arrow enterDelay={0} enterNextDelay={0}>
            <IconButton size="small" onClick={() => toggleFit('width')} color={fitMode === 'width' ? 'primary' : 'default'}>
              <FitScreenIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          {/* 세로 맞춤 */}
          <Tooltip title="세로 높이 맞춤" arrow enterDelay={0} enterNextDelay={0}>
            <IconButton size="small" onClick={() => toggleFit('height')} color={fitMode === 'height' ? 'primary' : 'default'}>
              <HeightIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          {/* 색상 반전 */}
          <Tooltip title="색상 반전" arrow enterDelay={0} enterNextDelay={0}>
            <IconButton size="small" onClick={onToggleInverted ?? (() => setLocalInverted((v) => !v))} color={inverted ? 'primary' : 'default'}>
              <InvertColorsIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

          {/* 뷰 모드 */}
          <ToggleButtonGroup
            size="small" value={viewMode} exclusive onChange={handleViewMode}
            sx={{ '& .MuiToggleButton-root': { py: 0.25, px: 0.75, border: 'none' } }}
          >
            <ToggleButton value="scroll">
              <Tooltip title="연속 스크롤" arrow enterDelay={0} enterNextDelay={0}><ViewStreamIcon fontSize="small" /></Tooltip>
            </ToggleButton>
            <ToggleButton value="single">
              <Tooltip title="한 페이지 보기" arrow enterDelay={0} enterNextDelay={0}><CropPortraitIcon fontSize="small" /></Tooltip>
            </ToggleButton>
            <ToggleButton value="double">
              <Tooltip title="두 페이지 보기" arrow enterDelay={0} enterNextDelay={0}><MenuBookIcon fontSize="small" /></Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>

          <Box sx={{ flex: 1 }} />
          <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem' }}>
            Space: UI 숨기기
          </Typography>
        </Box>
      )}

      {/* ── 스크롤 모드 ── */}
      {viewMode === 'scroll' && (
        <Box ref={containerRef} data-testid="pdf-scroll-area" sx={{ flex: 1, overflow: 'auto', bgcolor: '#3a3a3a', py: 3, px: 2 }}>
          {pages.map((page, idx) => {
            const pn = idx + 1;
            return (
              <Box key={idx} ref={(el) => { pageRefs.current[idx] = el as HTMLDivElement | null; }}>
                {page ? (
                  <PdfPage
                    page={page} scale={scale} pageNumber={pn} inverted={inverted}
                  />
                ) : (
                  /* 아직 로드되지 않은 페이지 플레이스홀더 — 스크롤 위치 유지 */
                  <Box
                    sx={{
                      width: phW, height: phH,
                      mx: 'auto', mb: 2,
                      bgcolor: '#fff',
                      boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <CircularProgress size={20} sx={{ opacity: 0.4 }} />
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      {/* ── 한 페이지 모드 ── */}
      {viewMode === 'single' && (
        <Box
          ref={containerRef} data-testid="pdf-scroll-area"
          sx={{ flex: 1, overflow: 'hidden', bgcolor: '#3a3a3a', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}
        >
          {pages[currentPage - 1] ? (
            <PdfPage
              page={pages[currentPage - 1]!} pageNumber={currentPage} {...basePageProps}
            />
          ) : (
            <Box
              sx={{
                width: phW, height: phH,
                bgcolor: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <CircularProgress size={28} />
            </Box>
          )}
        </Box>
      )}

      {/* ── 두 페이지 모드 ── */}
      {viewMode === 'double' && (
        <Box
          ref={containerRef} data-testid="pdf-scroll-area"
          sx={{ flex: 1, overflow: 'hidden', bgcolor: '#3a3a3a', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, p: 3 }}
        >
          {/* 좌측 페이지 */}
          {pages[currentPage - 1] ? (
            <PdfPage
              page={pages[currentPage - 1]!} pageNumber={currentPage} {...basePageProps}
            />
          ) : (
            <Box
              sx={{
                width: phW, height: phH,
                bgcolor: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <CircularProgress size={28} />
            </Box>
          )}
          {/* 우측 페이지 */}
          {currentPage < totalPages && (
            pages[currentPage] ? (
              <PdfPage
                page={pages[currentPage]!} pageNumber={currentPage + 1} {...basePageProps}
              />
            ) : (
              <Box
                sx={{
                  width: phW, height: phH,
                  bgcolor: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
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
  );
}
