import React, { useState, useEffect, useRef, useCallback, useSyncExternalStore } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, IconButton, Snackbar, Tooltip, Typography, useMediaQuery } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import AddToDriveOutlinedIcon from '@mui/icons-material/AddToDriveOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
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
import { usePdfitI18n, useTranslatedDisplayText } from '../i18n/usePdfitI18n';
import DocumentExportDialog from '../components/DocumentExportDialog.js';
import { addSampleToLibrary, getSampleLibraryStatus } from '../api/samples.js';
import BookMetadataDialog from '../components/BookMetadataDialog.js';
import { usePdfitFrontConfig } from '../context.js';
import { tagsApi } from '../api/tags.js';
import TagChip from '../components/TagChip.js';
import { recordDocumentOpened } from '../model/documentOpenHistory.js';
import { folderLibraryModel } from '../model/folderLibraryModel.js';

function DisplayFolderName({ value }: { value: string }) {
  return <>{useTranslatedDisplayText(value)}</>;
}

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
  const { t, ui } = usePdfitI18n();
  const isTabletTouch = useMediaQuery('(min-width: 720px) and (pointer: coarse)');
  const { bookMetadataEnabled, bookResearchAccess } = usePdfitFrontConfig();
  const { folder, filename } = useParams<{ folder: string; filename: string }>();
  const { search } = useLocation();

  const folderName = decodeRouteParam(folder);
  const fileName = decodeRouteParam(filename);
  const searchParams = new URLSearchParams(search);
  const requestedPage = Number.parseInt(searchParams.get('page') ?? '', 10);
  const requestedDriveFileId = searchParams.get('driveFileId');
  const [resolvedDriveFileId, setResolvedDriveFileId] = useState<string | null>(requestedDriveFileId);
  const driveFileId = requestedDriveFileId ?? resolvedDriveFileId;
  const sample = searchParams.get('sample') === '1';
  const pendingUpload = isPendingUploadDriveFileId(driveFileId);
  const initialPageFromUrl = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : null;
  const pdfUrl = pendingUpload ? '' : sample && driveFileId
    ? `/api/samples/${encodeURIComponent(driveFileId)}/content`
    : foldersApi.fileUrl(folderName, fileName, driveFileId);
  const returnToFolder = useCallback(() => {
    // The dedicated viewer is mounted under BrowserRouter basename="/viewer".
    // Leaving through navigate() would keep that basename and reinterpret the
    // service route as another viewer document. Use a full navigation to the
    // service app instead.
    window.location.assign(sample ? '/samples' : `/folder/${encodeURIComponent(folderName)}`);
  }, [folderName, sample]);
  const navigationModel = getViewerNavigationModel(folderName, fileName);
  useSyncExternalStore(navigationModel.subscribe, navigationModel.getSnapshot, navigationModel.getSnapshot);
  const initialPage = navigationModel.getRequestedPage() ?? initialPageFromUrl;

  useEffect(() => {
    let active = true;
    if (sample || requestedDriveFileId) { setResolvedDriveFileId(requestedDriveFileId); return () => { active = false; }; }
    setResolvedDriveFileId(null);
    const resolveId = async () => {
      let files = await foldersApi.listFiles(folderName);
      let match = files.find((file) => file.name === fileName && file.driveFileId);
      if (!match) {
        await foldersApi.refresh();
        files = await foldersApi.listFiles(folderName);
        match = files.find((file) => file.name === fileName && file.driveFileId);
      }
      if (active) setResolvedDriveFileId(match?.driveFileId ?? null);
    };
    void resolveId().catch(() => { if (active) setResolvedDriveFileId(null); });
    return () => { active = false; };
  }, [fileName, folderName, requestedDriveFileId, sample]);

  useEffect(() => {
    document.title = fileName;
    return () => { document.title = 'Books'; };
  }, [fileName]);

  useEffect(() => {
    if (!sample && !pendingUpload) recordDocumentOpened({ folder: folderName, filename: fileName, driveFileId });
  }, [driveFileId, fileName, folderName, pendingUpload, sample]);

  useEffect(() => {
    const unregister = registerViewerWindow(folderName, fileName);
    const onCommand = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || !isViewerCommand(event.data)) return;
      const command = event.data;
      if (command.folder !== folderName || command.filename !== fileName) return;
      if (!sample) recordDocumentOpened({ folder: folderName, filename: fileName, driveFileId: command.driveFileId ?? driveFileId });
      navigationModel.requestPage(command.page);
      window.focus();
      if (event.source) (event.source as WindowProxy).postMessage({ type: 'pdfit-viewer-command-ack', requestId: command.requestId }, event.origin);
    };
    window.addEventListener('message', onCommand);
    return () => {
      window.removeEventListener('message', onCommand);
      unregister();
    };
  }, [driveFileId, fileName, folderName, navigationModel, sample]);

  const { savedState, stateLoaded, reportState } = useViewerState(folderName, fileName, driveFileId);
  const fitRestoredTabletSpread = isTabletTouch && savedState?.viewMode === 'double';
  const initialViewerScale = !fitRestoredTabletSpread && savedState?.fitMode === 'none' ? savedState.scale : undefined;
  const initialViewerFitMode = fitRestoredTabletSpread ? 'height' : 'none';
  // A received same-window page command has the same precedence as `?page=`:
  // restoring the saved scroll position afterwards would move away from it.
  const initialScrollTop = initialPage == null ? savedState?.scrollTop : undefined;

  // Remote PDFs are opened with PDF.js by default so HTTP byte ranges can show
  // the first page without downloading the entire document. GPU remains an
  // explicit opt-in for diagnostics and high-performance local comparisons.
  const [viewerEngine, setViewerEngine] = useState<'gpu' | 'legacy'>(searchParams.get('engine') === 'gpu' ? 'gpu' : 'legacy');
  const [exportOpen, setExportOpen] = useState(false);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [sampleLibraryState, setSampleLibraryState] = useState<'checking' | 'available' | 'adding' | 'added' | 'error'>(sample ? 'checking' : 'available');
  const [sampleLibraryNotice, setSampleLibraryNotice] = useState<string | null>(null);
  const [viewerTags, setViewerTags] = useState<string[]>([]);
  const [viewerTagColors, setViewerTagColors] = useState<Record<string, string>>({});
  const latestViewerStateRef = useRef<ViewerStatePayload | null>(null);
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
    }, driveFileId).optimistic;
  }, [bookmarkModel, driveFileId, fileName, folderName]);
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
      void listBookmarks(folderName, fileName, driveFileId)
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
  }, [bookmarkModel, driveFileId, fileName, folderName]);

  useEffect(() => {
    let cancelled = false;
    const reload = () => {
      if (sample) {
        setViewerTags([]);
        setViewerTagColors({});
        return;
      }
      void Promise.all([
        tagsApi.listForBook(folderName, fileName, driveFileId),
        tagsApi.listSummary(),
      ]).then(([tags, summaries]) => {
        if (cancelled) return;
        setViewerTags(tags);
        setViewerTagColors(Object.fromEntries(summaries.map((item) => [item.name, item.color])));
      }).catch(() => {
        if (!cancelled) setViewerTags([]);
      });
    };
    reload();
    window.addEventListener('tags-changed', reload);
    return () => {
      cancelled = true;
      window.removeEventListener('tags-changed', reload);
    };
  }, [driveFileId, fileName, folderName, sample]);

  const handleStateChange = useCallback(
    (state: Omit<ViewerStatePayload, 'uiHidden'>) => {
      const next = { ...state, uiHidden: false };
      latestViewerStateRef.current = next;
      reportState(next);
    },
    [reportState],
  );

  const handleGpuUnavailable = useCallback(() => {
    setViewerEngine('legacy');
  }, []);

  const handleDocumentUnavailable = useCallback(() => {
    if (sample) return;
    void foldersApi.refresh().then(() => {
      folderLibraryModel.invalidateFiles();
      window.dispatchEvent(new Event('folders-changed'));
      window.dispatchEvent(new Event('tags-changed'));
    }).catch((error) => console.warn('[pdfit] Library refresh after missing document failed.', error));
  }, [sample]);

  useEffect(() => {
    let active = true;
    if (!sample || !driveFileId) return () => { active = false; };
    setSampleLibraryState('checking');
    void getSampleLibraryStatus(driveFileId)
      .then(({ inLibrary }) => { if (active) setSampleLibraryState(inLibrary ? 'added' : 'available'); })
      .catch(() => { if (active) setSampleLibraryState('available'); });
    return () => { active = false; };
  }, [driveFileId, sample]);

  const handleAddSampleToLibrary = useCallback(async () => {
    if (!driveFileId || sampleLibraryState === 'adding' || sampleLibraryState === 'added') return;
    setSampleLibraryState('adding');
    try {
      await addSampleToLibrary(driveFileId);
      setSampleLibraryState('added');
      setSampleLibraryNotice(t('sampleAddedToLibrary'));
      window.dispatchEvent(new Event('folders-changed'));
    } catch {
      setSampleLibraryState('error');
      setSampleLibraryNotice(t('sampleAddToLibraryFailed'));
    }
  }, [driveFileId, sampleLibraryState, t]);

  return (
    <Box component="main" sx={{ display: 'flex', flexDirection: 'column', height: '100vh', '@supports (height: 100dvh)': { height: '100dvh' }, minHeight: 0, overflow: 'hidden' }}>

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
          <Tooltip title={t('backToList')} arrow>
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
            <DisplayFolderName value={folderName} />
          </Typography>
          <Typography variant="caption" color="text.disabled">/</Typography>
          <Typography variant="body2" fontWeight={600} noWrap translate="no" sx={{ minWidth: 0, maxWidth: { xs: '34vw', md: '42vw' } }}>
            {fileName}
          </Typography>
          {viewerTags.length > 0 ? (
            <Box data-testid="viewer-header-tags" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, maxWidth: { xs: '32vw', md: '38vw' }, overflow: 'hidden' }}>
              {viewerTags.map((tag) => <TagChip key={tag} tag={tag} color={viewerTagColors[tag]} compact plain />)}
            </Box>
          ) : null}
          <Box sx={{ flex: 1 }} />
          {sample && driveFileId && (
            <Button
              data-testid="viewer-add-sample-to-library"
              size="small"
              variant="outlined"
              startIcon={sampleLibraryState === 'checking' || sampleLibraryState === 'adding'
                ? <CircularProgress size={15} color="inherit" />
                : sampleLibraryState === 'added'
                  ? <CheckCircleOutlineIcon fontSize="small" />
                  : <AddToDriveOutlinedIcon fontSize="small" />}
              disabled={sampleLibraryState === 'checking' || sampleLibraryState === 'adding' || sampleLibraryState === 'added'}
              onClick={() => void handleAddSampleToLibrary()}
              sx={{ flexShrink: 0, whiteSpace: 'nowrap', fontWeight: 700 }}
            >
              {sampleLibraryState === 'added'
                ? t('sampleInMyLibrary')
                : sampleLibraryState === 'adding'
                  ? t('sampleAddingToLibrary')
                  : t('sampleAddToMyLibrary')}
            </Button>
          )}
          {bookMetadataEnabled && driveFileId && !sample && !pendingUpload ? (
            <Button
              data-testid="viewer-book-metadata-open"
              size="small"
              variant="outlined"
              startIcon={<MenuBookOutlinedIcon fontSize="small" />}
              onClick={() => setMetadataOpen(true)}
              sx={{ flexShrink: 0, whiteSpace: 'nowrap', fontWeight: 700 }}
            >
              {ui("파일 정보")}</Button>
          ) : null}
          <Tooltip title={t('exportDocument')} arrow>
            <IconButton data-testid="document-export-open" aria-label={t('exportDocument')} size="small" onClick={() => setExportOpen(true)}>
              <FileDownloadOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
      </Box>

      <DocumentExportDialog
        open={exportOpen}
        folder={folderName}
        filename={fileName}
        driveFileId={driveFileId}
        documentUrl={pdfUrl}
        currentViewerState={latestViewerStateRef.current ?? savedState}
        onClose={() => setExportOpen(false)}
      />

      <BookMetadataDialog
        target={metadataOpen && driveFileId ? { driveFileId, filename: fileName } : null}
        onClose={() => setMetadataOpen(false)}
        onCoverChanged={() => window.dispatchEvent(new Event('folders-changed'))}
        canUseAiResearch={bookResearchAccess?.() ?? false}
        onUpgrade={() => window.location.assign('/pricing')}
      />

      <Snackbar
        open={sampleLibraryNotice !== null}
        autoHideDuration={4000}
        onClose={(_event, reason) => { if (reason !== 'clickaway') setSampleLibraryNotice(null); }}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert severity={sampleLibraryState === 'error' ? 'error' : 'success'} variant="filled" onClose={() => setSampleLibraryNotice(null)}>
          {sampleLibraryNotice}
        </Alert>
      </Snackbar>

      {pendingUpload ? (
        <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', p: 3 }}>
          <Alert severity="info">{t('pdfStillUploading')}</Alert>
        </Box>
      ) : stateLoaded ? viewerEngine === 'gpu' ? (
        <PdfGpuViewer
          url={pdfUrl}
          initialPage={initialPage ?? savedState?.page ?? null}
          initialScale={initialViewerScale}
          initialFitMode={initialViewerFitMode}
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
          initialScale={initialViewerScale}
          initialFitMode={initialViewerFitMode}
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
          onDocumentUnavailable={handleDocumentUnavailable}
        />
      ) : (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CircularProgress size={28} />
        </Box>
      )}
    </Box>
  );
}
