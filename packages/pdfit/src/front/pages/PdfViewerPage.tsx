import React, { useState, useEffect, useRef, useCallback, useSyncExternalStore } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { Alert, Box, CircularProgress, IconButton, Tooltip, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import { foldersApi } from '../api/folders';
import { useViewerState } from '../hooks/useViewerState';
import PdfViewer from '../components/PdfViewer';
import PdfGpuViewer from '../components/PdfGpuViewer';
import type { ViewerStatePayload } from '../api/viewerState';
import { isPointInViewerCenterGrid, ViewerSessionModel } from '../viewer/sessionModel';
import { listBookmarks } from '../api/bookmarks';
import { BookmarkModel } from '../model/bookmarkModel';
import type { PdfGpuCaptureResult } from '@pdfgpu/core';
import type { UpdateBookmarkRequest } from '../../common/protocol/bookmarks/index.js';
import { getViewerNavigationModel } from '../model/viewerNavigationModel.js';
import { subscribeBookmarkChanges } from '../model/bookmarkEvents.js';
import { createBookmarkOptimistically, deleteBookmarkOptimistically, updateBookmarkOptimistically } from '../model/optimisticBookmarks.js';
import { isViewerCommand, registerViewerWindow } from '../viewer/openViewer.js';

function decodeRouteParam(value: string | undefined): string {
  let decoded = value ?? '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return decoded;
      decoded = next;
    } catch {
      return decoded;
    }
  }
  return decoded;
}

export default function PdfViewerPage() {
  const { folder, filename } = useParams<{ folder: string; filename: string }>();
  const { search } = useLocation();

  const folderName = decodeRouteParam(folder);
  const fileName = decodeRouteParam(filename);
  const searchParams = new URLSearchParams(search);
  const requestedPage = Number.parseInt(searchParams.get('page') ?? '', 10);
  const driveFileId = searchParams.get('driveFileId');
  const initialPageFromUrl = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : null;
  const pdfUrl = foldersApi.fileUrl(folderName, fileName, driveFileId);
  const returnToFolder = useCallback(() => {
    // The dedicated viewer is mounted under BrowserRouter basename="/viewer".
    // Leaving through navigate() would keep that basename and reinterpret the
    // service route as another viewer document. Use a full navigation to the
    // service app instead.
    window.location.assign(`/folder/${encodeURIComponent(folderName)}`);
  }, [folderName]);
  const navigationModel = getViewerNavigationModel(folderName, fileName);
  useSyncExternalStore(navigationModel.subscribe, navigationModel.getSnapshot, navigationModel.getSnapshot);
  const initialPage = navigationModel.getRequestedPage() ?? initialPageFromUrl;

  useEffect(() => {
    document.title = fileName;
    return () => { document.title = 'Books'; };
  }, [fileName]);

  useEffect(() => {
    const unregister = registerViewerWindow(folderName, fileName);
    const onCommand = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || !isViewerCommand(event.data)) return;
      const command = event.data;
      if (command.folder !== folderName || command.filename !== fileName) return;
      navigationModel.requestPage(command.page);
      window.focus();
      if (event.source) (event.source as WindowProxy).postMessage({ type: 'pdfit-viewer-command-ack', requestId: command.requestId }, event.origin);
    };
    window.addEventListener('message', onCommand);
    return () => {
      window.removeEventListener('message', onCommand);
      unregister();
    };
  }, [fileName, folderName, navigationModel]);

  const { savedState, stateLoaded, reportState } = useViewerState(folderName, fileName);
  // A received same-window page command has the same precedence as `?page=`:
  // restoring the saved scroll position afterwards would move away from it.
  const initialScrollTop = initialPage == null ? savedState?.scrollTop : undefined;

  const [viewerEngine, setViewerEngine] = useState<'gpu' | 'legacy'>(searchParams.get('engine') === 'legacy' ? 'legacy' : 'gpu');
  const sessionModelRef = useRef<ViewerSessionModel | null>(null);
  if (!sessionModelRef.current) sessionModelRef.current = new ViewerSessionModel();
  const sessionModel = sessionModelRef.current;
  const bookmarkModelRef = useRef<BookmarkModel | null>(null);
  if (!bookmarkModelRef.current) bookmarkModelRef.current = new BookmarkModel();
  const bookmarkModel = bookmarkModelRef.current;
  useSyncExternalStore(bookmarkModel.subscribe, bookmarkModel.getSnapshot, bookmarkModel.getSnapshot);
  const bookmarks = bookmarkModel.getAll();
  const [bookmarkError, setBookmarkError] = useState<string | null>(null);
  const handleBookmarkCaptured = useCallback(async (capture: PdfGpuCaptureResult) => {
    setBookmarkError(null);
    return createBookmarkOptimistically(folderName, fileName, { pageIndex: capture.pageIndex, rect: capture.rect, borderColor: '#f59e0b', fillColor: null, fillOpacity: 0.2, comment: null, imageMimeType: capture.mimeType, imageBase64: capture.imageBase64 }, {
      upsert: (record) => bookmarkModel.upsert(record),
      remove: (id) => bookmarkModel.remove(id),
      failed: (message) => setBookmarkError(message),
    }).optimistic;
  }, [bookmarkModel, fileName, folderName]);
  const handleBookmarkUpdated = useCallback(async (id: string, request: UpdateBookmarkRequest) => {
    const current = bookmarkModel.getAll().find((bookmark) => bookmark.id === id);
    if (!current) return;
    setBookmarkError(null);
    updateBookmarkOptimistically(current, request, {
      upsert: (record) => bookmarkModel.upsert(record),
      remove: (bookmarkId) => bookmarkModel.remove(bookmarkId),
      failed: (message) => setBookmarkError(message),
    });
  }, [bookmarkModel]);
  const handleBookmarkDeleted = useCallback(async (id: string) => {
    const current = bookmarkModel.getAll().find((bookmark) => bookmark.id === id);
    if (!current) return;
    setBookmarkError(null);
    deleteBookmarkOptimistically(current, {
      upsert: (record) => bookmarkModel.upsert(record),
      remove: (bookmarkId) => bookmarkModel.remove(bookmarkId),
      failed: (message) => setBookmarkError(message),
    });
  }, [bookmarkModel]);
  const sessionState = useSyncExternalStore(
    sessionModel.subscribe,
    sessionModel.getState,
    sessionModel.getState,
  );
  const uiInitializedRef = useRef(false);

  useEffect(() => {
    uiInitializedRef.current = false;
    sessionModel.dispatch({ type: 'setUiHidden', value: false });
    sessionModel.dispatch({ type: 'setInverted', value: false });
  }, [fileName, folderName, sessionModel]);

  // savedState가 처음 도착하면 uiHidden 복원
  useEffect(() => {
    if (savedState && !uiInitializedRef.current) {
      uiInitializedRef.current = true;
      sessionModel.dispatch({ type: 'setUiHidden', value: savedState.uiHidden });
      sessionModel.dispatch({ type: 'setInverted', value: savedState.inverted });
    }
  }, [savedState, sessionModel]);

  useEffect(() => {
    let cancelled = false;
    const reload = () => {
      void listBookmarks(folderName, fileName)
        .then((items) => { if (!cancelled) bookmarkModel.replace(items); })
        .catch(() => { if (!cancelled) bookmarkModel.replace([]); });
    };
    reload();
    const unsubscribe = subscribeBookmarkChanges((signal) => {
      if (signal.folder !== folderName || signal.filename !== fileName) return;
      if (signal.record) bookmarkModel.upsert(signal.record);
      else if (signal.id) bookmarkModel.remove(signal.id);
      else reload();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [bookmarkModel, fileName, folderName]);

  // 최신 뷰어 내부 상태 캐시 (uiHidden 병합용)
  const viewerInternalRef = useRef<Omit<ViewerStatePayload, 'uiHidden'> | null>(null);

  const handleStateChange = useCallback(
    (state: Omit<ViewerStatePayload, 'uiHidden'>) => {
      viewerInternalRef.current = state;
      reportState({ ...state, uiHidden: sessionModel.getState().uiHidden });
    },
    [reportState],
  );

  const handleGpuUnavailable = useCallback(() => {
    setViewerEngine('legacy');
  }, []);

  const toggleUi = useCallback(() => {
    sessionModel.dispatch({ type: 'toggleUi' });
    if (viewerInternalRef.current) {
      reportState({ ...viewerInternalRef.current, uiHidden: sessionModel.getState().uiHidden });
    }
  }, [reportState, sessionModel]);

  const handleViewerClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest('a, button, input, textarea, select, [role="button"], [role="dialog"], [data-viewer-center-toggle-ignore="true"]')) return;
    if (!isPointInViewerCenterGrid(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())) return;
    toggleUi();
  }, [toggleUi]);

  // 스페이스바는 페이지/렌더러와 독립된 세션 모델에만 입력을 보낸다.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === ' ') {
        e.preventDefault();
        toggleUi();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleUi]);

  return (
    <Box component="main" onClick={handleViewerClick} sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

      {/* 상단 헤더 (UI 숨김 시 사라짐) */}
      {!sessionState.uiHidden && (
        <Box
          sx={{
            display: 'flex', alignItems: 'center', gap: 1.5,
            px: 2, py: 1,
            bgcolor: 'background.paper',
            borderBottom: '1px solid', borderColor: 'divider',
            flexShrink: 0,
          }}
        >
          <Tooltip title="목록으로 돌아가기" arrow>
            <IconButton size="small" onClick={returnToFolder}>
              <ArrowBackIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <FolderOpenIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
          <Typography
            variant="caption" color="text.secondary"
            sx={{ cursor: 'pointer', '&:hover': { color: 'primary.main' } }}
            onClick={returnToFolder}
          >
            {folderName}
          </Typography>
          <Typography variant="caption" color="text.disabled">/</Typography>
          <Typography variant="body2" fontWeight={600} noWrap sx={{ flex: 1 }}>
            {fileName}
          </Typography>
        </Box>
      )}

      {bookmarkError && <Alert severity="error" onClose={() => setBookmarkError(null)} sx={{ position: 'absolute', zIndex: 20, top: 8, right: 12, maxWidth: 440 }}>{bookmarkError}</Alert>}

      {stateLoaded ? viewerEngine === 'gpu' ? (
        <PdfGpuViewer
          url={pdfUrl}
          initialPage={initialPage ?? savedState?.page ?? null}
          initialScale={savedState?.scale}
          initialFitMode={savedState?.fitMode}
          initialViewMode={savedState?.viewMode}
          inverted={sessionState.inverted}
          onToggleInverted={() => sessionModel.dispatch({ type: 'toggleInverted' })}
          initialScrollTop={initialScrollTop}
          onStateChange={handleStateChange}
          onUnavailable={handleGpuUnavailable}
          uiHidden={sessionState.uiHidden}
          bookmarks={bookmarks}
          onBookmarkCaptured={handleBookmarkCaptured}
          onBookmarkUpdated={handleBookmarkUpdated}
          onBookmarkDeleted={handleBookmarkDeleted}
        />
      ) : (
        <PdfViewer
          url={pdfUrl}
          initialPage={initialPage ?? savedState?.page ?? null}
          initialScale={savedState?.scale}
          initialFitMode={savedState?.fitMode}
          initialViewMode={savedState?.viewMode}
          initialInverted={sessionState.inverted}
          inverted={sessionState.inverted}
          onToggleInverted={() => sessionModel.dispatch({ type: 'toggleInverted' })}
          initialScrollTop={initialScrollTop}
          onStateChange={handleStateChange}
          uiHidden={sessionState.uiHidden}
          bookmarks={bookmarks}
          onBookmarkCaptured={handleBookmarkCaptured}
          onBookmarkDeleted={handleBookmarkDeleted}
        />
      ) : (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CircularProgress size={28} />
        </Box>
      )}
    </Box>
  );
}
