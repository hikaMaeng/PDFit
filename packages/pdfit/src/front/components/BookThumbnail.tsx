import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type React from 'react';
import { Box, CircularProgress, IconButton, Tooltip, Typography } from '@mui/material';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import RefreshIcon from '@mui/icons-material/Refresh';
import { coverStateKey, ensureCoverOverrides, subscribeCovers, withCoverVersion } from '../api/covers.js';
import { usePdfitI18n } from '../i18n/usePdfitI18n.js';
import { useThumbnailSlot } from './thumbnailLoadQueue.js';

const THUMBNAIL_SX = { position: 'relative', display: 'grid', placeItems: 'center', width: '100%', aspectRatio: '3 / 4', overflow: 'hidden', bgcolor: 'action.hover' } as const;
const COMPACT_THUMBNAIL_SX = {
  ...THUMBNAIL_SX, height: '100%', aspectRatio: 'auto', borderRadius: .5,
  '& .MuiTypography-root': { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' },
} as const;

export type BookThumbnailProps = {
  folder: string;
  filename: string;
  url: string;
  thumbnailUrl?: string;
  serverCover?: boolean;
  driveFileId?: string;
  modifiedAt?: string;
  onCoverVisible?: (driveFileId: string) => void;
};

export function hasLocalServerCover(book: BookThumbnailProps) {
  return Boolean(book.serverCover && book.thumbnailUrl && !book.driveFileId);
}

export default function BookThumbnail({ book, pending, compact = false }: { book: BookThumbnailProps; pending: boolean; compact?: boolean }) {
  const localServerCover = hasLocalServerCover(book);
  const { folder, filename, url, thumbnailUrl, driveFileId, modifiedAt, onCoverVisible } = book;
  useSyncExternalStore(subscribeCovers, () => localServerCover ? coverStateKey(folder, filename) : '', () => '');
  useEffect(() => { if (localServerCover) ensureCoverOverrides(); }, [localServerCover]);
  if (pending) {
    return <Box data-testid="pending-cover-placeholder" sx={compact ? COMPACT_THUMBNAIL_SX : THUMBNAIL_SX}>
      <PictureAsPdfIcon color="disabled" sx={{ fontSize: compact ? 22 : 48 }} />
    </Box>;
  }
  if (book.serverCover && thumbnailUrl) {
    const source = localServerCover ? withCoverVersion(thumbnailUrl, folder, filename) : thumbnailUrl;
    return <ServerCoverThumbnail thumbnailUrl={source} title={filename} compact={compact} />;
  }
  return <FirstPageThumbnail url={url} thumbnailUrl={thumbnailUrl} title={filename} modifiedAt={modifiedAt} driveFileId={driveFileId}
    onCoverVisible={onCoverVisible} compact={compact} />;
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

function FirstPageThumbnail({ url, thumbnailUrl, title, modifiedAt, driveFileId, onCoverVisible, compact }: { url: string; thumbnailUrl?: string; title: string; modifiedAt?: string; driveFileId?: string; onCoverVisible?: (driveFileId: string) => void; compact: boolean }) {
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
  // The stored thumbnail is one of the parallel loads the page allows at a time.
  const driveSlot = useThumbnailSlot(visible && useDriveThumbnail && state !== 'ready', `${thumbnailUrl ?? url}|${attempt}`);

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

  return <Box ref={hostRef} data-testid="pdf-cover-thumbnail" aria-label={ui("{p0} 첫 페이지 표지", { p0: title })} sx={compact ? COMPACT_THUMBNAIL_SX : THUMBNAIL_SX}>
    {useDriveThumbnail && visible && (driveSlot || state === 'ready') ? <Box
      component="img"
      src={thumbnailUrl}
      alt=""
      draggable={false}
      onLoad={() => setState('ready')}
      onError={() => { if (thumbnailUrl) missingDriveThumbnails.add(thumbnailUrl); setState((current) => current === 'ready' ? current : 'queued'); setDriveThumbnailFailed(true); }}
      sx={{ display: 'block', position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', bgcolor: '#fff', opacity: state === 'ready' ? 1 : 0 }}
    /> : null}
    <canvas ref={canvasRef} style={{ display: state === 'ready' && !useDriveThumbnail ? 'block' : 'none', width: '100%', height: '100%', objectFit: 'contain', background: '#fff' }} />
    {state === 'loading' ? <Box role="status" aria-label={ui("표지 불러오는 중")} sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', overflow: 'hidden', color: 'text.disabled', bgcolor: 'action.hover', '&::after': { content: '\"\"', position: 'absolute', inset: 0, transform: 'translateX(-100%)', background: 'linear-gradient(100deg, transparent 20%, rgba(255,255,255,.09) 50%, transparent 80%)', animation: 'pdfit-cover-shimmer 1.15s ease-in-out infinite' }, '@keyframes pdfit-cover-shimmer': { to: { transform: 'translateX(100%)' } } }}>
      <PictureAsPdfIcon sx={{ fontSize: compact ? 22 : 46, opacity: .42 }} />
      <CircularProgress size={20} thickness={4} sx={{ position: 'absolute', color: 'primary.main' }} />
    </Box> : null}
    {(state === 'idle' || state === 'queued' || state === 'background' || state === 'error') ? <Box sx={{ display: 'grid', justifyItems: 'center', gap: .75, px: 1.5, textAlign: 'center' }}>
      <PictureAsPdfIcon color={state === 'error' ? 'error' : 'disabled'} sx={{ fontSize: compact ? 22 : 48 }} />
      {state === 'background' ? <Typography role="status" variant="caption" color="text.secondary" sx={{ lineHeight: 1.35 }}>{t('coverPreparing')}</Typography> : null}
      {state === 'error' ? <Tooltip title={errorReason === 'timeout' ? t('coverTimeoutReason') : t('coverFailedReason')} arrow><Box sx={{ cursor: 'help' }}><Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 700, lineHeight: 1.35 }}>{t('coverUnavailable')}</Typography><Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: .25, lineHeight: 1.25 }}>{errorReason === 'timeout' ? t('coverTimeoutLabel') : t('coverFailedLabel')}</Typography></Box></Tooltip> : null}
    </Box> : null}
    {state === 'error' ? <Tooltip title={`${errorReason === 'timeout' ? t('coverTimeoutReason') : t('coverFailedReason')} ${t('retry')}`}><IconButton data-testid="retry-cover" aria-label={t('retry')} size="small" onClick={(event) => { event.preventDefault(); event.stopPropagation(); if (thumbnailUrl) missingDriveThumbnails.delete(thumbnailUrl); setErrorReason('failed'); setState('queued'); setDriveThumbnailFailed(false); setAttempt((value) => value + 1); }} sx={{ position: 'absolute', right: compact ? 1 : 8, bottom: compact ? 1 : 8, p: compact ? .25 : undefined, color: 'text.secondary', bgcolor: 'background.paper', boxShadow: 1, '&:hover': { bgcolor: 'background.paper', color: 'primary.main' } }}><RefreshIcon sx={{ fontSize: compact ? 14 : 20 }} /></IconButton></Tooltip> : null}
  </Box>;
}

// Delay before asking again for a cover the server has queued; the last value repeats.
const SERVER_COVER_RETRY_DELAYS_MS = [3_000, 6_000, 12_000, 30_000, 60_000];

/**
 * Cover rendered by the server's background thumbnail task (local libraries). The
 * browser only displays the image. Asking for a cover that does not exist yet moves
 * it to the front of the server queue, so the card asks again while it is on screen.
 */
function ServerCoverThumbnail({ thumbnailUrl, title, compact }: { thumbnailUrl: string; title: string; compact: boolean }) {
  const { t, ui } = usePdfitI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const currentUrl = useRef(thumbnailUrl);
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'queued' | 'failed'>('idle');
  const [attempt, setAttempt] = useState(0);
  // One of the page's parallel thumbnail loads; released as soon as the image is in.
  const slot = useThumbnailSlot(visible && state === 'loading', `${thumbnailUrl}|${attempt}`);
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

  const showImage = state === 'ready' || (visible && state === 'loading' && slot);
  // Retries use a distinct URL so a failed load is never answered from the browser's memory cache.
  const source = attempt === 0 ? thumbnailUrl : `${thumbnailUrl}${thumbnailUrl.includes('?') ? '&' : '?'}r=${attempt}`;

  return <Box ref={hostRef} data-testid="pdf-cover-thumbnail" data-cover-source="server" data-cover-state={state} aria-label={ui("{p0} 첫 페이지 표지", { p0: title })} sx={compact ? COMPACT_THUMBNAIL_SX : THUMBNAIL_SX}>
    {showImage ? <Box
      component="img"
      src={source}
      alt=""
      draggable={false}
      decoding="async"
      onLoad={() => setState('ready')}
      onError={() => { void explainMiss(); }}
      sx={{ display: 'block', position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', bgcolor: '#fff', opacity: state === 'ready' ? 1 : 0 }}
    /> : null}
    {state !== 'ready' ? <Box sx={{ display: 'grid', justifyItems: 'center', gap: .75, px: 1.5, textAlign: 'center' }}>
      <PictureAsPdfIcon color={state === 'failed' ? 'error' : 'disabled'} sx={{ fontSize: compact ? 22 : 48 }} />
      {state === 'queued' ? <Typography role="status" variant="caption" color="text.secondary" sx={{ lineHeight: 1.35 }}>{t('coverPreparing')}</Typography> : null}
      {state === 'failed' ? <Tooltip title={t('coverFailedReason')} arrow><Box sx={{ cursor: 'help' }}><Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 700, lineHeight: 1.35 }}>{t('coverUnavailable')}</Typography><Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: .25, lineHeight: 1.25 }}>{t('coverFailedLabel')}</Typography></Box></Tooltip> : null}
    </Box> : null}
    {state === 'failed' ? <Tooltip title={`${t('coverFailedReason')} ${t('retry')}`}><IconButton data-testid="retry-cover" aria-label={t('retry')} size="small" onClick={retry} sx={{ position: 'absolute', right: compact ? 1 : 8, bottom: compact ? 1 : 8, p: compact ? .25 : undefined, color: 'text.secondary', bgcolor: 'background.paper', boxShadow: 1, '&:hover': { bgcolor: 'background.paper', color: 'primary.main' } }}><RefreshIcon sx={{ fontSize: compact ? 14 : 20 }} /></IconButton></Tooltip> : null}
  </Box>;
}
