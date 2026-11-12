import React, { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Checkbox, CircularProgress, IconButton, ThemeProvider, Tooltip, Typography, createTheme, useTheme } from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import DeleteIcon from '@mui/icons-material/Delete';
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ImageSearchIcon from '@mui/icons-material/ImageSearch';
import HashTagIcon from './HashTagIcon.js';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import RefreshIcon from '@mui/icons-material/Refresh';
import { usePdfitI18n } from '../i18n/usePdfitI18n.js';
import { isPendingUploadDriveFileId, openViewer, viewerUrl } from '../viewer/openViewer.js';
import { DRAG_TYPE } from '../layout/LNB.js';
import TagChip from './TagChip.js';
import { formatDocumentOpenedDate, getDocumentOpenedAt, subscribeDocumentOpenHistory } from '../model/documentOpenHistory.js';
import { bookMetadataApi } from '../api/bookMetadata.js';
import { viewerStateApi } from '../api/viewerState.js';
import { coversAvailable, ensureCoverOverrides, getCoversRevision, subscribeCovers, withCoverVersion } from '../api/covers.js';
import RealCoverDialog from './RealCoverDialog.js';

type Props = {
  filename: string;
  url: string;
  thumbnailUrl?: string;
  /** `thumbnailUrl` is produced by the server's thumbnail task; the browser must not render the PDF itself. */
  serverCover?: boolean;
  folder: string;
  driveFileId?: string;
  size?: number;
  modifiedAt?: string;
  tags: string[];
  tagColors: Record<string, string>;
  selected: boolean;
  hideSelection?: boolean;
  hideFileActions?: boolean;
  autoTagging?: boolean;
  autoTagDisabled?: boolean;
  onSelectionChange: (folder: string, filename: string, selected: boolean) => void;
  /** 관리 핸들러(태그 삭제·태그 관리·이동·삭제)는 없으면 해당 버튼을 그리지 않는다(읽기 전용 목록). */
  onTagDelete?: (folder: string, filename: string, tag: string) => void;
  onManageTags?: (folder: string, filename: string) => void;
  onAutoTag?: (folder: string, filename: string) => void;
  onEditMetadata?: (folder: string, filename: string) => void;
  onCoverVisible?: (driveFileId: string) => void;
  onMove?: (folder: string, filename: string) => void;
  onDelete?: (folder: string, filename: string) => void;
};

function formatBytes(bytes?: number): string {
  if (bytes === undefined) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const COVER_CACHE = 'pdfit-cover-thumbnails-v1';
const missingDriveThumbnails = new Set<string>();
const persistedCoverThumbnails = new Set<string>();
// Google Drive range reads and PDF.js parsing are independent per card. Six
// low-resolution jobs fill a typical desktop row without flooding the browser.
const MAX_CONCURRENT_COVER_RENDERS = 6;
const COVER_RENDER_TIMEOUT_MS = 60_000;
type CoverJob = { cancelled: boolean; run: () => Promise<void>; resolve: () => void; reject: (error: unknown) => void };
const coverQueue: CoverJob[] = [];
let activeCoverRenders = 0;

function pumpCoverQueue(): void {
  while (activeCoverRenders < MAX_CONCURRENT_COVER_RENDERS && coverQueue.length > 0) {
    const job = coverQueue.shift()!;
    if (job.cancelled) { job.resolve(); continue; }
    activeCoverRenders += 1;
    void job.run().then(job.resolve, job.reject).finally(() => { activeCoverRenders -= 1; pumpCoverQueue(); });
  }
}

function scheduleCoverRender(run: () => Promise<void>, priority = false): { promise: Promise<void>; cancel: () => void } {
  let job!: CoverJob;
  const promise = new Promise<void>((resolve, reject) => { job = { cancelled: false, run, resolve, reject }; });
  if (priority) coverQueue.unshift(job); else coverQueue.push(job);
  pumpCoverQueue();
  return { promise, cancel: () => { job.cancelled = true; } };
}

function coverCacheRequest(url: string, modifiedAt?: string): Request {
  const key = new URL('/__pdfit_cover__', window.location.origin);
  key.searchParams.set('source', url);
  if (modifiedAt) key.searchParams.set('modified', modifiedAt);
  return new Request(key);
}

async function drawCachedCover(canvas: HTMLCanvasElement, response: Response): Promise<void> {
  const bitmap = await createImageBitmap(await response.blob());
  try {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.style.aspectRatio = `${bitmap.width} / ${bitmap.height}`;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas 2D context is unavailable.');
    context.drawImage(bitmap, 0, 0);
  } finally { bitmap.close(); }
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.84));
}

async function persistCoverThumbnail(url: string, blob: Blob): Promise<void> {
  if (persistedCoverThumbnails.has(url)) return;
  persistedCoverThumbnails.add(url);
  try {
    const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
    if (!response.ok) throw new Error(`Thumbnail persistence failed with ${response.status}.`);
    missingDriveThumbnails.delete(url);
  } catch {
    persistedCoverThumbnails.delete(url);
  }
}

function FirstPageThumbnail({ url, thumbnailUrl, title, modifiedAt, driveFileId, onCoverVisible }: { url: string; thumbnailUrl?: string; title: string; modifiedAt?: string; driveFileId?: string; onCoverVisible?: (driveFileId: string) => void }) {
  const { t, ui } = usePdfitI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const autoLookupStarted = useRef(false);
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<'idle' | 'queued' | 'loading' | 'background' | 'ready' | 'error'>('idle');
  const [errorReason, setErrorReason] = useState<'timeout' | 'failed'>('failed');
  const [attempt, setAttempt] = useState(0);
  const [driveThumbnailFailed, setDriveThumbnailFailed] = useState(() => Boolean(thumbnailUrl && missingDriveThumbnails.has(thumbnailUrl)));
  const useDriveThumbnail = Boolean(thumbnailUrl && !driveThumbnailFailed);

  useEffect(() => {
    setState('idle');
    setDriveThumbnailFailed(Boolean(thumbnailUrl && missingDriveThumbnails.has(thumbnailUrl)));
    setAttempt(0);
    setErrorReason('failed');
  }, [modifiedAt, thumbnailUrl, url]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new IntersectionObserver(([entry]) => {
      // Keep observing after the first intersection. When a user scrolls past
      // unfinished covers, their queued/range jobs must release slots for the
      // cards that are actually on screen now.
      setVisible(entry.isIntersecting);
      if (entry.isIntersecting) {
        setState((current) => current === 'ready' ? current : 'queued');
      }
    }, { rootMargin: '180px 0px' });
    observer.observe(host);
    return () => observer.disconnect();
  }, [driveFileId]);

  useEffect(() => {
    if (!visible || !driveFileId || !onCoverVisible || autoLookupStarted.current) return;
    autoLookupStarted.current = true;
    onCoverVisible(driveFileId);
  }, [driveFileId, onCoverVisible, visible]);

  useEffect(() => {
    if (state !== 'loading') return;
    const timer = window.setTimeout(() => setState((current) => current === 'loading' ? 'background' : current), 4_000);
    return () => window.clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    if (!visible || useDriveThumbnail || !('caches' in window)) return;
    let cancelled = false;
    const restore = async () => {
      const cached = await (await caches.open(COVER_CACHE)).match(coverCacheRequest(url, modifiedAt));
      const canvas = canvasRef.current;
      if (!cached || !canvas || cancelled) return;
      await drawCachedCover(canvas, cached);
      if (cancelled) return;
      setState('ready');
      if (thumbnailUrl) {
        const jpeg = await canvasBlob(canvas);
        if (jpeg && !cancelled) void persistCoverThumbnail(thumbnailUrl, jpeg);
      }
    };
    void restore();
    return () => { cancelled = true; };
  }, [modifiedAt, thumbnailUrl, url, visible, useDriveThumbnail]);

  useEffect(() => {
    if (!visible || useDriveThumbnail) return;
    let cancelled = false;
    let cancelScheduled: (() => void) | null = null;
    let destroyDocument: (() => Promise<void>) | null = null;
    let cancelRender: (() => void) | null = null;
    let renderTimeout: ReturnType<typeof setTimeout> | null = null;
    let expired = false;
    const render = async () => {
      try {
        const cacheRequest = coverCacheRequest(url, modifiedAt);
        if ('caches' in window) {
          const cached = await (await caches.open(COVER_CACHE)).match(cacheRequest);
          const canvas = canvasRef.current;
          if (cached && canvas && !cancelled) {
            await drawCachedCover(canvas, cached);
            if (!cancelled) {
              setState('ready');
              if (thumbnailUrl) {
                const jpeg = await canvasBlob(canvas);
                if (jpeg && !cancelled) void persistCoverThumbnail(thumbnailUrl, jpeg);
              }
            }
            return;
          }
        }
        const scheduled = scheduleCoverRender(async () => {
          if (cancelled) return;
          setState('loading');
          const operation = async () => {
            const { loadPdfJs } = await import('../pdfjs.js');
            if (cancelled || expired) return;
            const pdfjs = await loadPdfJs();
            if (cancelled || expired) return;
            const loadingTask = pdfjs.getDocument({ url, rangeChunkSize: 256 * 1024, disableAutoFetch: true, disableStream: false });
            destroyDocument = () => loadingTask.destroy();
            const document = await loadingTask.promise;
            if (cancelled || expired) { await loadingTask.destroy(); return; }
            const page = await document.getPage(1);
            if (cancelled || expired) { await loadingTask.destroy(); return; }
            const baseViewport = page.getViewport({ scale: 1 });
            const cssWidth = 150;
            const scale = cssWidth / baseViewport.width;
            const viewport = page.getViewport({ scale: scale * Math.min(window.devicePixelRatio || 1, 1.25) });
            const canvas = canvasRef.current;
            if (!canvas || cancelled || expired) { await loadingTask.destroy(); return; }
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            canvas.style.aspectRatio = `${baseViewport.width} / ${baseViewport.height}`;
            const context = canvas.getContext('2d', { alpha: false });
            if (!context) throw new Error('Canvas 2D context is unavailable.');
            const renderTask = page.render({ canvas, canvasContext: context, viewport, background: 'rgb(255,255,255)' });
            cancelRender = () => renderTask.cancel();
            await renderTask.promise;
            if (!cancelled && !expired) {
              if ('caches' in window) {
                const blob = await canvasBlob(canvas);
                if (blob && !expired) {
                  await (await caches.open(COVER_CACHE)).put(cacheRequest, new Response(blob, { headers: { 'Content-Type': blob.type } }));
                  if (thumbnailUrl) void persistCoverThumbnail(thumbnailUrl, blob);
                }
              }
              if (!cancelled && !expired) setState('ready');
            }
            await loadingTask.destroy();
            destroyDocument = null;
          };
          const timeout = new Promise<never>((_resolve, reject) => {
            renderTimeout = setTimeout(() => {
              expired = true;
              cancelRender?.();
              if (destroyDocument) void destroyDocument();
              reject(new Error('PDF cover render timed out.'));
            }, COVER_RENDER_TIMEOUT_MS);
          });
          try {
            await Promise.race([operation(), timeout]);
          } finally {
            if (renderTimeout) { clearTimeout(renderTimeout); renderTimeout = null; }
          }
        }, attempt > 0);
        cancelScheduled = scheduled.cancel;
        await scheduled.promise;
      } catch (error) {
        if (!cancelled && !(error instanceof Error && error.name === 'RenderingCancelledException')) {
          setErrorReason(error instanceof Error && error.message.includes('timed out') ? 'timeout' : 'failed');
          setState('error');
        }
      }
    };
    void render();
    return () => {
      cancelled = true;
      if (renderTimeout) clearTimeout(renderTimeout);
      cancelScheduled?.();
      cancelRender?.();
      if (destroyDocument) void destroyDocument();
    };
  }, [attempt, modifiedAt, url, visible, useDriveThumbnail]);

  return <Box ref={hostRef} data-testid="pdf-cover-thumbnail" aria-label={ui("{p0} 첫 페이지 표지", { p0: title })} sx={{ position: 'relative', display: 'grid', placeItems: 'center', width: '100%', aspectRatio: '3 / 4', overflow: 'hidden', bgcolor: 'action.hover' }}>
    {useDriveThumbnail && visible ? <Box
      component="img"
      src={thumbnailUrl}
      alt=""
      onLoad={() => setState('ready')}
      onError={() => { if (thumbnailUrl) missingDriveThumbnails.add(thumbnailUrl); setState((current) => current === 'ready' ? current : 'queued'); setDriveThumbnailFailed(true); }}
      sx={{ display: 'block', position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', bgcolor: '#fff', opacity: state === 'ready' ? 1 : 0 }}
    /> : null}
    <canvas ref={canvasRef} style={{ display: state === 'ready' && !useDriveThumbnail ? 'block' : 'none', width: '100%', height: '100%', objectFit: 'contain', background: '#fff' }} />
    {state === 'loading' ? <Box role="status" aria-label={ui("표지 불러오는 중")} sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', overflow: 'hidden', color: 'text.disabled', bgcolor: 'action.hover', '&::after': { content: '\"\"', position: 'absolute', inset: 0, transform: 'translateX(-100%)', background: 'linear-gradient(100deg, transparent 20%, rgba(255,255,255,.09) 50%, transparent 80%)', animation: 'pdfit-cover-shimmer 1.15s ease-in-out infinite' }, '@keyframes pdfit-cover-shimmer': { to: { transform: 'translateX(100%)' } } }}>
      <PictureAsPdfIcon sx={{ fontSize: 46, opacity: .42 }} />
      <CircularProgress size={20} thickness={4} sx={{ position: 'absolute', color: 'primary.main' }} />
    </Box> : null}
    {(state === 'idle' || state === 'queued' || state === 'background' || state === 'error') ? <Box sx={{ display: 'grid', justifyItems: 'center', gap: .75, px: 1.5, textAlign: 'center' }}>
      <PictureAsPdfIcon color={state === 'error' ? 'error' : 'disabled'} sx={{ fontSize: 48 }} />
      {state === 'background' ? <Typography role="status" variant="caption" color="text.secondary" sx={{ lineHeight: 1.35 }}>{t('coverPreparing')}</Typography> : null}
      {state === 'error' ? <Tooltip title={errorReason === 'timeout' ? t('coverTimeoutReason') : t('coverFailedReason')} arrow><Box sx={{ cursor: 'help' }}><Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 700, lineHeight: 1.35 }}>{t('coverUnavailable')}</Typography><Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: .25, lineHeight: 1.25 }}>{errorReason === 'timeout' ? t('coverTimeoutLabel') : t('coverFailedLabel')}</Typography></Box></Tooltip> : null}
    </Box> : null}
    {state === 'error' ? <Tooltip title={`${errorReason === 'timeout' ? t('coverTimeoutReason') : t('coverFailedReason')} ${t('retry')}`}><IconButton data-testid="retry-cover" aria-label={t('retry')} size="small" onClick={(event) => { event.preventDefault(); event.stopPropagation(); if (thumbnailUrl) missingDriveThumbnails.delete(thumbnailUrl); setErrorReason('failed'); setState('queued'); setDriveThumbnailFailed(false); setAttempt((value) => value + 1); }} sx={{ position: 'absolute', right: 8, bottom: 8, color: 'text.secondary', bgcolor: 'background.paper', boxShadow: 1, '&:hover': { bgcolor: 'background.paper', color: 'primary.main' } }}><RefreshIcon fontSize="small" /></IconButton></Tooltip> : null}
  </Box>;
}

// Delay before asking again for a cover the server has queued; the last value repeats.
const SERVER_COVER_RETRY_DELAYS_MS = [3_000, 6_000, 12_000, 30_000, 60_000];

/**
 * Cover rendered by the server's background thumbnail task (local libraries). The
 * browser only displays the image. Asking for a cover that does not exist yet moves
 * it to the front of the server queue, so the card asks again while it is on screen.
 */
function ServerCoverThumbnail({ thumbnailUrl, title }: { thumbnailUrl: string; title: string }) {
  const { t, ui } = usePdfitI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const currentUrl = useRef(thumbnailUrl);
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'queued' | 'failed'>('idle');
  const [attempt, setAttempt] = useState(0);
  currentUrl.current = thumbnailUrl;

  useEffect(() => {
    setState('idle');
    setAttempt(0);
  }, [thumbnailUrl]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '180px 0px' });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (visible) setState((current) => current === 'idle' ? 'loading' : current);
  }, [thumbnailUrl, visible]);

  useEffect(() => {
    if (state !== 'queued' || !visible) return;
    const delay = SERVER_COVER_RETRY_DELAYS_MS[Math.min(attempt, SERVER_COVER_RETRY_DELAYS_MS.length - 1)];
    const timer = window.setTimeout(() => { setAttempt((value) => value + 1); setState('loading'); }, delay);
    return () => window.clearTimeout(timer);
  }, [attempt, state, visible]);

  // An <img> error carries no status, so ask the server why: 202 means the cover is queued.
  const explainMiss = async () => {
    const url = thumbnailUrl;
    let next: 'reload' | 'queued' | 'failed' = 'failed';
    try {
      const response = await fetch(url, { cache: 'no-store' });
      // `response.ok` is also true for 202, which means "still queued", not "ready".
      next = response.status === 200 ? 'reload' : response.status === 202 ? 'queued' : 'failed';
    } catch { /* offline or server restarting: shown as unavailable with a retry button */ }
    if (currentUrl.current !== url) return;
    if (next === 'reload') setAttempt((value) => value + 1);
    else setState(next);
  };

  const retry = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setAttempt((value) => value + 1);
    setState('loading');
  };

  const showImage = state === 'ready' || (visible && state === 'loading');
  // Retries use a distinct URL so a failed load is never answered from the browser's memory cache.
  const source = attempt === 0 ? thumbnailUrl : `${thumbnailUrl}${thumbnailUrl.includes('?') ? '&' : '?'}r=${attempt}`;

  return <Box ref={hostRef} data-testid="pdf-cover-thumbnail" data-cover-source="server" data-cover-state={state} aria-label={ui("{p0} 첫 페이지 표지", { p0: title })} sx={{ position: 'relative', display: 'grid', placeItems: 'center', width: '100%', aspectRatio: '3 / 4', overflow: 'hidden', bgcolor: 'action.hover' }}>
    {showImage ? <Box
      component="img"
      src={source}
      alt=""
      decoding="async"
      onLoad={() => setState('ready')}
      onError={() => { void explainMiss(); }}
      sx={{ display: 'block', position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', bgcolor: '#fff', opacity: state === 'ready' ? 1 : 0 }}
    /> : null}
    {state !== 'ready' ? <Box sx={{ display: 'grid', justifyItems: 'center', gap: .75, px: 1.5, textAlign: 'center' }}>
      <PictureAsPdfIcon color={state === 'failed' ? 'error' : 'disabled'} sx={{ fontSize: 48 }} />
      {state === 'queued' ? <Typography role="status" variant="caption" color="text.secondary" sx={{ lineHeight: 1.35 }}>{t('coverPreparing')}</Typography> : null}
      {state === 'failed' ? <Tooltip title={t('coverFailedReason')} arrow><Box sx={{ cursor: 'help' }}><Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 700, lineHeight: 1.35 }}>{t('coverUnavailable')}</Typography><Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: .25, lineHeight: 1.25 }}>{t('coverFailedLabel')}</Typography></Box></Tooltip> : null}
    </Box> : null}
    {state === 'failed' ? <Tooltip title={`${t('coverFailedReason')} ${t('retry')}`}><IconButton data-testid="retry-cover" aria-label={t('retry')} size="small" onClick={retry} sx={{ position: 'absolute', right: 8, bottom: 8, color: 'text.secondary', bgcolor: 'background.paper', boxShadow: 1, '&:hover': { bgcolor: 'background.paper', color: 'primary.main' } }}><RefreshIcon fontSize="small" /></IconButton></Tooltip> : null}
  </Box>;
}

// Two lines of 1.35em text plus the vertical padding; the overlay keeps this height even for one-line titles.
const TITLE_BAND_MIN_HEIGHT = 'calc(2.7em + 12px)';
const OVERLAY_TEXT_SX = { color: 'rgba(255,255,255,.86)', fontSize: '.75rem', lineHeight: 1.4 } as const;

export default function PdfCoverItem(props: Props) {
  const { language, t, ui } = usePdfitI18n();
  const navigate = useNavigate();
  const theme = useTheme();
  const aiAccentColor = theme.palette.mode === 'light' ? '#b7791f' : '#f59e0b';
  // Tag colors are chosen per theme mode; the overlay is always dark, so its tags use the dark palette.
  const overlayTheme = useMemo(() => createTheme({ palette: { mode: 'dark' } }), []);
  const pending = isPendingUploadDriveFileId(props.driveFileId);
  const [infoPinned, setInfoPinned] = useState(false);
  const [infoRequested, setInfoRequested] = useState(false);
  const [lastPage, setLastPage] = useState<number | null>(null);
  const openedAt = useSyncExternalStore(subscribeDocumentOpenHistory, () => getDocumentOpenedAt({ folder: props.folder, filename: props.filename, driveFileId: props.driveFileId }), () => null);
  const openedLabel = formatDocumentOpenedDate(openedAt, language);
  const open = () => { if (!pending) openViewer({ folder: props.folder, filename: props.filename, driveFileId: props.driveFileId }); };
  const viewerHref = viewerUrl({ folder: props.folder, filename: props.filename, driveFileId: props.driveFileId });
  const infoId = useId();
  // Real-book covers apply to local files whose cover the server renders.
  const localServerCover = Boolean(props.serverCover && props.thumbnailUrl && !props.driveFileId);
  useSyncExternalStore(subscribeCovers, getCoversRevision, () => 0);
  useEffect(() => { if (localServerCover) ensureCoverOverrides(); }, [localServerCover]);
  const coverThumbnailUrl = localServerCover && props.thumbnailUrl ? withCoverVersion(props.thumbnailUrl, props.folder, props.filename) : props.thumbnailUrl;
  const canReplaceCover = localServerCover && !pending && Boolean(props.onManageTags) && coversAvailable();
  const [coverDialogOpen, setCoverDialogOpen] = useState(false);

  // The last page is the page the viewer saved in its viewer state (the same value that reopening
  // the book restores). It is read only once the overlay is first shown, so a grid of cards does
  // not issue one request per card. The separate reading-progress record is never written by the
  // viewer, so it is not used here.
  useEffect(() => {
    if (!infoRequested || pending) return;
    let cancelled = false;
    viewerStateApi.get(props.folder, props.filename, props.driveFileId).then((state) => { if (!cancelled) setLastPage(typeof state?.page === 'number' ? state.page : null); }).catch(() => { if (!cancelled) setLastPage(null); });
    return () => { cancelled = true; };
  }, [infoRequested, openedAt, pending, props.driveFileId, props.filename, props.folder]);

  const lastPageLabel = lastPage !== null && (lastPage > 1 || openedAt) ? String(lastPage) : '—';
  const infoLabel = infoPinned ? t('hideCoverInfo') : t('showCoverInfo');
  const requestInfo = () => setInfoRequested(true);

  return <Box component="article" data-testid="pdf-cover-card" sx={{ position: 'relative', display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', border: '1px solid', borderColor: props.selected ? 'primary.main' : 'divider', borderRadius: 1.5, bgcolor: 'background.paper', boxShadow: props.selected ? '0 0 0 1px #3b82f6' : '0 8px 20px rgba(0,0,0,.10)', transition: 'transform 160ms ease, border-color 160ms ease', '&:hover': { transform: 'translateY(-2px)', borderColor: 'primary.light' } }}>
    <Box
      data-testid="pdf-cover-media"
      data-info-open={infoPinned ? 'true' : 'false'}
      onMouseEnter={requestInfo}
      sx={{
        position: 'relative',
        '& [data-cover-info]': { opacity: infoPinned ? 1 : 0, visibility: infoPinned ? 'visible' : 'hidden' },
        // Hover only exists on pointer devices; touch devices use the info button instead.
        '@media (hover: hover)': { '&:hover [data-cover-info]': { opacity: 1, visibility: 'visible' } },
      }}
    >
      <Box component="a" href={viewerHref} draggable={!pending} onDragStart={(event) => { if (pending) return; event.dataTransfer.effectAllowed = 'copyMove'; event.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ folder: props.folder, filename: props.filename, driveFileId: props.driveFileId })); }} onClick={(event) => { event.preventDefault(); open(); }} sx={{ display: 'block', color: 'inherit', textDecoration: 'none', cursor: pending ? 'wait' : 'pointer', opacity: pending ? .65 : 1 }}>
        {pending
          ? <Box data-testid="pending-cover-placeholder" sx={{ display: 'grid', placeItems: 'center', aspectRatio: '3 / 4', bgcolor: 'action.hover' }}><PictureAsPdfIcon color="disabled" sx={{ fontSize: 48 }} /></Box>
          : props.serverCover && props.thumbnailUrl
            ? <ServerCoverThumbnail thumbnailUrl={coverThumbnailUrl ?? props.thumbnailUrl} title={props.filename} />
            : <FirstPageThumbnail url={props.url} thumbnailUrl={props.thumbnailUrl} title={props.filename} modifiedAt={props.modifiedAt} driveFileId={props.driveFileId} onCoverVisible={props.onCoverVisible} />}
      </Box>
      {/* Overlay layer: the info panel fills what the title band leaves; both sit on top of the thumbnail. */}
      <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', pointerEvents: 'none' }}>
        <ThemeProvider theme={overlayTheme}>
          <Box
            id={infoId}
            data-cover-info
            data-testid="pdf-cover-info-overlay"
            onClick={(event) => { if (event.target === event.currentTarget) open(); }}
            sx={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: .75, p: 1, pt: 4.5, bgcolor: 'rgba(0,0,0,.72)', pointerEvents: 'auto', cursor: pending ? 'wait' : 'pointer', transition: 'opacity 140ms ease' }}
          >
            {pending ? <Typography role="status" variant="caption" sx={{ alignSelf: 'flex-start', px: .75, py: .25, border: '1px solid', borderColor: 'warning.main', borderRadius: 99, color: 'warning.light', fontWeight: 650 }}>{t('uploadPending')}</Typography> : null}
            <Box data-testid="pdf-cover-tags" sx={{ display: 'flex', flexWrap: 'wrap', gap: .5 }}>
              {props.tags.map((tag) => <TagChip key={tag} tag={tag} color={props.tagColors[tag]} compact plain disabled={pending} onDelete={props.onTagDelete ? () => props.onTagDelete?.(props.folder, props.filename, tag) : undefined} onClick={() => navigate(`/tag/${encodeURIComponent(tag)}`)} />)}
            </Box>
            {props.onEditMetadata ? <span><Button size="small" data-testid="pdf-cover-document-info" disabled={pending} onMouseEnter={() => { if (props.driveFileId && !pending) bookMetadataApi.prefetch(props.driveFileId); }} onFocus={() => { if (props.driveFileId && !pending) bookMetadataApi.prefetch(props.driveFileId); }} onClick={() => props.onEditMetadata?.(props.folder, props.filename)} sx={{ minWidth: 0, p: 0, fontSize: '.75rem', color: 'primary.light', textDecoration: 'underline', textUnderlineOffset: '3px' }}>{t('documentInfo')}</Button></span> : null}
            <Typography component="time" data-testid="pdf-cover-opened-at" dateTime={openedAt ?? undefined} variant="caption" sx={OVERLAY_TEXT_SX}>{t('openedAt')}: {openedLabel}</Typography>
            <Typography data-testid="pdf-cover-last-page" variant="caption" sx={OVERLAY_TEXT_SX}>{t('lastPage')}: {lastPageLabel}</Typography>
            <Typography data-testid="pdf-cover-file-size" variant="caption" sx={OVERLAY_TEXT_SX}>{formatBytes(props.size)}</Typography>
          </Box>
        </ThemeProvider>
        <Box data-testid="pdf-cover-title-row" sx={{ flexShrink: 0, minHeight: TITLE_BAND_MIN_HEIGHT, display: 'flex', alignItems: 'center', gap: .5, px: 1, py: '6px', fontSize: '.85rem', lineHeight: 1.35, bgcolor: 'rgba(0,0,0,.62)', color: '#fff', pointerEvents: 'none' }}>
          {!props.hideSelection && <Checkbox size="small" data-testid="pdf-cover-selection" sx={{ p: .25, width: 24, height: 24, flexShrink: 0, color: 'rgba(255,255,255,.8)', pointerEvents: 'auto' }} inputProps={{ 'aria-label': `${t('selectPdf')}: ${props.filename}` }} checked={props.selected} disabled={pending} onChange={(_, checked) => props.onSelectionChange(props.folder, props.filename, checked)} />}
          <Typography component="a" href={viewerHref} onClick={(event) => { event.preventDefault(); open(); }} title={props.filename} translate="no" sx={{ minWidth: 0, flex: 1, color: '#fff', fontWeight: 700, fontSize: 'inherit', lineHeight: 'inherit', textDecoration: 'none', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere', pointerEvents: 'auto' }}>{props.filename}</Typography>
        </Box>
      </Box>
      <IconButton
        data-testid="pdf-cover-info-toggle"
        aria-label={infoLabel}
        aria-expanded={infoPinned}
        aria-controls={infoId}
        size="small"
        onClick={() => { requestInfo(); setInfoPinned((value) => !value); }}
        sx={{ position: 'absolute', top: 6, right: 6, zIndex: 1, width: 24, height: 24, p: 0, color: '#fff', bgcolor: 'rgba(0,0,0,.55)', '&:hover': { bgcolor: 'rgba(0,0,0,.78)' } }}
      >
        <InfoOutlinedIcon sx={{ fontSize: 18 }} />
      </IconButton>
    </Box>
    {(props.onAutoTag || props.onManageTags || canReplaceCover || (!props.hideFileActions && (props.onMove || props.onDelete))) && <Box data-testid="pdf-cover-actions" sx={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: '1fr', '& > span, & > [data-testid] > span': { display: 'flex' }, '& .MuiIconButton-root': { flex: 1, height: 36, p: 0, borderRadius: 0 } }}>
      <Box data-testid="pdf-cover-tag-actions" sx={{ display: 'contents' }}>
        {props.onAutoTag ? <Tooltip title={t('aiAutoTag')}><span><IconButton aria-label={t('aiAutoTag')} size="small" disabled={pending || props.autoTagging || props.autoTagDisabled} onClick={() => props.onAutoTag?.(props.folder, props.filename)} sx={{ color: aiAccentColor, '&:hover': { bgcolor: `${aiAccentColor}1f` } }}>{props.autoTagging ? <CircularProgress size={18} color="inherit" /> : <AutoAwesomeIcon fontSize="small" />}</IconButton></span></Tooltip> : null}
        {canReplaceCover ? <Tooltip title={t('realCover')}><span><IconButton aria-label={t('realCover')} data-testid="pdf-cover-real-cover" size="small" onClick={() => setCoverDialogOpen(true)} sx={{ color: 'primary.main' }}><ImageSearchIcon fontSize="small" /></IconButton></span></Tooltip> : null}
        {props.onManageTags ? <Tooltip title={t('manageTags')}><span><IconButton aria-label={t('manageTags')} size="small" disabled={pending} onClick={() => props.onManageTags?.(props.folder, props.filename)} sx={{ color: 'primary.main' }}><HashTagIcon fontSize="small" /></IconButton></span></Tooltip> : null}
      </Box>
      {!props.hideFileActions && <Box data-testid="pdf-cover-file-actions" sx={{ display: 'contents' }}>
        {props.onMove ? <Tooltip title={t('moveToFolder')}><span><IconButton aria-label={t('moveToFolder')} size="small" disabled={pending} onClick={() => props.onMove?.(props.folder, props.filename)}><DriveFileMoveIcon fontSize="small" /></IconButton></span></Tooltip> : null}
        {props.onDelete ? <Tooltip title={t('delete')}><span><IconButton aria-label={t('delete')} size="small" color="error" disabled={pending} onClick={() => props.onDelete?.(props.folder, props.filename)}><DeleteIcon fontSize="small" /></IconButton></span></Tooltip> : null}
      </Box>}
    </Box>}
    {canReplaceCover ? <RealCoverDialog open={coverDialogOpen} folder={props.folder} filename={props.filename} onClose={() => setCoverDialogOpen(false)} /> : null}
  </Box>;
}
