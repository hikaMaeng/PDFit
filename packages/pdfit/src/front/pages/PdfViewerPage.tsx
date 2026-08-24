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
import { ViewerSessionModel } from '../viewer/sessionModel';
import { listBookmarks } from '../api/bookmarks';
import { BookmarkModel } from '../model/bookmarkModel';
import type { PdfGpuCaptureResult } from '@pdfgpu/core';
import type { UpdateBookmarkRequest } from '../../common/protocol/bookmarks/index.js';
import { getViewerNavigationModel } from '../model/viewerNavigationModel.js';
import { subscribeBookmarkChanges } from '../model/bookmarkEvents.js';
import { createBookmarkOptimistically, deleteBookmarkOptimistically, updateBookmarkOptimistically } from '../model/optimisticBookmarks.js';
import { isPendingUploadDriveFileId, isViewerCommand, registerViewerWindow } from '../viewer/openViewer.js';

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
  const pendingUpload = isPendingUploadDriveFileId(driveFileId);
  const initialPageFromUrl = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : null;
  const pdfUrl = pendingUpload ? '' : foldersApi.fileUrl(folderName, fileName, driveFileId);
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

  const { savedState, stateLoaded, reportState } = useViewerState(folderName, fileName, driveFileId);
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
  const handleBookmarkCaptured = useCallback(async (capture: PdfGpuCaptureResult) => {
    return createBookmarkOptimistically(folderName, fileName, { pageIndex: capture.pageIndex, rect: capture.rect, borderColor: '#f59e0b', fillColor: null, fillOpacity: 0.2, comment: null, imageMimeType: capture.mimeType, imageBase64: capture.imageBase64 }, {
      upsert: (record) => bookmarkModel.upsert(record),
      remove: (id) => bookmarkModel.remove(id),
    }).optimistic;
  }, [bookmarkModel, fileName, folderName]);
  const handleBookmarkUpdated = useCallback(async (id: string, request: UpdateBookmarkRequest) => {
    const current = bookmarkModel.getAll().find((bookmark) => bookmark.id === id);
    if (!current) return;
    updateBookmarkOptimistically(current, request, {
      upsert: (record) => bookmarkModel.upsert(record),
      remove: (bookmarkId) => bookmarkModel.remove(bookmarkId),
    });
  }, [bookmarkModel]);
  const handleBookmarkDeleted = useCallback(async (id: string) => {
    const current = bookmarkModel.getAll().find((bookmark) => bookmark.id === id);
    if (!current) return;
    deleteBookmarkOptimistically(current, {
      upsert: (record) => bookmarkModel.upsert(record),
      remove: (bookmarkId) => bookmarkModel.remove(bookmarkId),
    });
  }, [bookmarkModel]);
  const sessionState = useSyncExternalStore(
    sessionModel.subscribe,
    sessionModel.getState,
    sessionModel.getState,
  );
  useEffect(() => {
    sessionModel.dispatch({ type: 'setInverted', value: false });
  }, [fileName, folderName, sessionModel]);

  // 색상 반전은 독서 상태로 복원하되, 뷰어 UI는 항상 노출한다.
  useEffect(() => {
    if (savedState) {
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

  const handleStateChange = useCallback(
    (state: Omit<ViewerStatePayload, 'uiHidden'>) => {
      reportState({ ...state, uiHidden: false });
    },
    [reportState],
  );

  const handleGpuUnavailable = useCallback(() => {
    setViewerEngine('legacy');
  }, []);

  return (
    <Box component="main" sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

      {/* 상단 헤더 */}
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

      {pendingUpload ? (
        <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', p: 3 }}>
          <Alert severity="info">이 PDF는 아직 Google Drive에 업로드 중입니다. 업로드가 완료된 후 다시 열어주세요.</Alert>
        </Box>
      ) : stateLoaded ? viewerEngine === 'gpu' ? (
        <PdfGpuViewer
          url={pdfUrl}
          initialPage={initialPage ?? savedState?.page ?? null}
          initialScale={savedState?.fitMode === 'none' ? savedState.scale : undefined}
          initialFitMode="none"
          initialViewMode={savedState?.viewMode}
          inverted={sessionState.inverted}
          onToggleInverted={() => sessionModel.dispatch({ type: 'toggleInverted' })}
          initialScrollTop={initialScrollTop}
          onStateChange={handleStateChange}
          onUnavailable={handleGpuUnavailable}
          uiHidden={false}
          bookmarks={bookmarks}
          onBookmarkCaptured={handleBookmarkCaptured}
          onBookmarkUpdated={handleBookmarkUpdated}
          onBookmarkDeleted={handleBookmarkDeleted}
        />
      ) : (
        <PdfViewer
          url={pdfUrl}
          initialPage={initialPage ?? savedState?.page ?? null}
          initialScale={savedState?.fitMode === 'none' ? savedState.scale : undefined}
          initialFitMode="none"
          initialViewMode={savedState?.viewMode}
          initialInverted={sessionState.inverted}
          inverted={sessionState.inverted}
          onToggleInverted={() => sessionModel.dispatch({ type: 'toggleInverted' })}
          initialScrollTop={initialScrollTop}
          onStateChange={handleStateChange}
          uiHidden={false}
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
