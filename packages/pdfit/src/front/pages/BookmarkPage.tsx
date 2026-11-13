import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Tab, Tabs, Typography } from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import NotesIcon from '@mui/icons-material/Notes';
import CloseIcon from '@mui/icons-material/Close';
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined';
import type { BookmarkRecord } from '../../common/protocol/bookmarks/index.js';
import { listAllBookmarks, retryBookmarkOcr } from '../api/bookmarks.js';
import OcrTextPanel, { type OcrPanelState } from '../components/OcrTextPanel.js';
import { bookmarkLibraryModel } from '../model/bookmarkModel.js';
import { subscribeBookmarkChanges } from '../model/bookmarkEvents.js';
import { deleteBookmarkOptimistically } from '../model/optimisticBookmarks.js';
import { openViewer } from '../viewer/openViewer.js';
import { usePdfitI18n, useTranslatedDisplayText } from '../i18n/usePdfitI18n.js';

const BOOKMARK_IMAGE_HEIGHT = 150;
function bookTitle(filename: string) {
  return filename.replace(/\.pdf$/i, '');
}

/** Panel state for a clip, or null where the runtime does not run OCR. */
function clipOcrState(bookmark: BookmarkRecord): OcrPanelState | null {
  const ocr = bookmark.ocr;
  if (!ocr) return null;
  if (ocr.status === 'done') return { status: 'done', text: ocr.text ?? '', source: ocr.source === 'vision' ? 'vision' : 'text-layer' };
  if (ocr.status === 'failed') return { status: 'failed', error: ocr.error ?? '' };
  return { status: ocr.status };
}

/** While a clip's text is being read, the list is read again this often, at most this many times. */
const OCR_POLL_MS = 5_000;
const OCR_POLL_LIMIT = 60;

function TranslatedFolderName({ value }: { value: string }) {
  return <>{useTranslatedDisplayText(value)}</>;
}

function ClipOcrBadge({ status }: { status: NonNullable<BookmarkRecord['ocr']>['status'] }) {
  const { t } = usePdfitI18n();
  const label = status === 'pending' ? t('ocrReading') : status === 'done' ? t('ocrClipHasText') : t('ocrClipNeedsAttention');
  return <Box data-testid="bookmark-card-ocr" data-ocr-status={status} role="img" aria-label={label} title={label} sx={{ position: 'absolute', top: 6, left: 6, display: 'grid', placeItems: 'center', width: 24, height: 24, borderRadius: '50%', color: status === 'done' ? '#fff' : status === 'pending' ? '#d4d4d8' : '#fbbf24', bgcolor: 'rgba(10,10,12,.78)' }}>
    {status === 'pending' ? <CircularProgress size={13} color="inherit" /> : status === 'done' ? <NotesIcon sx={{ fontSize: 15 }} /> : <ReportProblemOutlinedIcon sx={{ fontSize: 15 }} />}
  </Box>;
}

function BookmarkCard({ bookmark, onOpen, onDelete, deleting }: { bookmark: BookmarkRecord; onOpen: (bookmark: BookmarkRecord) => void; onDelete: (bookmark: BookmarkRecord) => void; deleting: boolean }) {
  const { language, t } = usePdfitI18n();
  const createdAt = new Date(bookmark.createdAt);
  const createdAtLabel = new Intl.DateTimeFormat(language, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(createdAt);

  return (
    <Box
      component="article"
      role="button"
      tabIndex={0}
      data-testid="bookmark-library-card"
      onClick={() => onOpen(bookmark)}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(bookmark); } }}
      sx={{ display: 'block', minWidth: 0, p: 0, overflow: 'hidden', textAlign: 'left', cursor: 'pointer', border: `2px solid ${bookmark.borderColor}`, borderRadius: 1.5, bgcolor: '#242426', color: 'inherit', '&:hover': { transform: 'translateY(-1px)', boxShadow: 3 } }}
    >
      <Box
        data-testid="bookmark-library-image-frame"
        sx={{
          position: 'relative',
          height: BOOKMARK_IMAGE_HEIGHT,
          minHeight: BOOKMARK_IMAGE_HEIGHT,
          maxHeight: BOOKMARK_IMAGE_HEIGHT,
          overflow: 'hidden',
          bgcolor: '#101012',
        }}
      >
        <Box component="img" src={bookmark.imageUrl} alt="" loading="lazy" decoding="async" sx={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />
        <IconButton
          data-testid="bookmark-card-delete"
          aria-label={t('deleteBookmark')}
          title={t('deleteBookmark')}
          color="error"
          size="small"
          disabled={deleting}
          onClick={(event) => { event.stopPropagation(); onDelete(bookmark); }}
          sx={{ position: 'absolute', top: 4, right: 4, p: 0.35, bgcolor: 'rgba(10,10,12,.78)', '&:hover': { bgcolor: 'rgba(10,10,12,.96)' } }}
        >
          {deleting ? <CircularProgress size={17} /> : <DeleteOutlineIcon fontSize="small" />}
        </IconButton>
        {bookmark.ocr ? <ClipOcrBadge status={bookmark.ocr.status} /> : null}
        {bookmark.fillColor && <Box data-testid="bookmark-library-color-indicator" sx={{ position: 'absolute', right: 8, bottom: 8, width: 11, height: 11, borderRadius: '50%', bgcolor: bookmark.fillColor, border: '1px solid rgba(255,255,255,.75)' }} />}
      </Box>
      <Box sx={{ display: 'grid', gridTemplateRows: 'repeat(3, 1rem)', gap: 0.35, px: 1, py: 0.75, minWidth: 0 }}>
        <Box data-testid="bookmark-card-title-row" sx={{ display: 'flex', gap: 0.75, alignItems: 'center', minWidth: 0 }}>
          <Typography variant="caption" noWrap translate="no" sx={{ flex: 1, minWidth: 0, color: 'text.primary', lineHeight: '1rem' }}>{bookTitle(bookmark.filename)}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, lineHeight: '1rem' }}>p. {bookmark.pageIndex + 1}</Typography>
        </Box>
        <Typography data-testid="bookmark-card-created-at" component="time" dateTime={createdAt.toISOString()} variant="caption" noWrap sx={{ display: 'block', color: '#71717a', lineHeight: '1rem' }}>
          {createdAtLabel}
        </Typography>
        <Typography data-testid="bookmark-card-comment" variant="caption" noWrap sx={{ display: 'block', minHeight: '1rem', color: '#a1a1aa', lineHeight: '1rem' }}>
          {bookmark.comment ?? ''}
        </Typography>
      </Box>
    </Box>
  );
}

export default function BookmarkPage() {
  const { t, ui } = usePdfitI18n();
  useSyncExternalStore(bookmarkLibraryModel.subscribe, bookmarkLibraryModel.getSnapshot, bookmarkLibraryModel.getSnapshot);
  const bookmarks = bookmarkLibraryModel.getAll();
  const [tab, setTab] = useState<'recent' | 'books'>('recent');
  const [loading, setLoading] = useState(bookmarks.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [previewBookmark, setPreviewBookmark] = useState<BookmarkRecord | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      bookmarkLibraryModel.replace(await listAllBookmarks());
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : ui("북마크를 불러오지 못했습니다."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const onBookmarkChange = (signal: Parameters<Parameters<typeof subscribeBookmarkChanges>[0]>[0]) => {
      if (signal.record) bookmarkLibraryModel.upsert(signal.record);
      else if (signal.id) bookmarkLibraryModel.remove(signal.id);
    };
    return subscribeBookmarkChanges(onBookmarkChange);
  }, [load]);

  // Clip text is read on the server after a clip is saved; re-read the list until it settles.
  const hasPendingOcr = bookmarks.some((bookmark) => bookmark.ocr?.status === 'pending');
  useEffect(() => {
    if (!hasPendingOcr) return;
    let polls = 0;
    const timer = window.setInterval(() => {
      polls += 1;
      if (polls > OCR_POLL_LIMIT) { window.clearInterval(timer); return; }
      void listAllBookmarks().then((records) => bookmarkLibraryModel.replace(records)).catch(() => undefined);
    }, OCR_POLL_MS);
    return () => window.clearInterval(timer);
  }, [hasPendingOcr]);

  // The dialog shows the live record, so its text appears when reading finishes.
  const previewRecord = previewBookmark ? bookmarks.find((bookmark) => bookmark.id === previewBookmark.id) ?? previewBookmark : null;
  const previewOcr = previewRecord ? clipOcrState(previewRecord) : null;
  const [retryingOcr, setRetryingOcr] = useState(false);
  // The text pane beside the clip; closed again whenever another clip is opened.
  const [textPaneOpen, setTextPaneOpen] = useState(false);
  useEffect(() => { setTextPaneOpen(false); }, [previewBookmark?.id]);
  const retryOcr = useCallback(async (record: BookmarkRecord) => {
    setRetryingOcr(true);
    setDeleteError(null);
    try {
      await retryBookmarkOcr(record.id);
      bookmarkLibraryModel.upsert({ ...record, ocr: { status: 'pending', text: null, source: null, error: null, updatedAt: null } });
    } catch (caught) {
      setDeleteError(t('ocrFailed', { reason: caught instanceof Error ? caught.message : String(caught) }));
    } finally {
      setRetryingOcr(false);
    }
  }, [t]);

  const byBook = useMemo(() => {
    const groups = new Map<string, BookmarkRecord[]>();
    for (const bookmark of bookmarks) {
      const key = `${bookmark.folder}\u0000${bookmark.filename}`;
      groups.set(key, [...(groups.get(key) ?? []), bookmark]);
    }
    return [...groups.values()];
  }, [bookmarks]);

  const removeBookmark = useCallback((bookmark: BookmarkRecord, onError: (message: string) => void) => {
    if (previewBookmark?.id === bookmark.id) setPreviewBookmark(null);
    deleteBookmarkOptimistically(bookmark, {
      upsert: (record) => bookmarkLibraryModel.upsert(record),
      remove: (id) => bookmarkLibraryModel.remove(id),
      failed: (message) => onError(message),
    });
    return true;
  }, [previewBookmark]);

  const gallery = (items: BookmarkRecord[]) => (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 1.25 }}>
      {items.map((bookmark) => <BookmarkCard key={bookmark.id} bookmark={bookmark} onOpen={setPreviewBookmark} onDelete={(item) => removeBookmark(item, setError)} deleting={false} />)}
    </Box>
  );

  const openPreviewViewer = useCallback(() => {
    if (!previewBookmark) return;
    openViewer({ folder: previewBookmark.folder, filename: previewBookmark.filename, page: previewBookmark.pageIndex + 1 });
  }, [previewBookmark]);

  const removePreviewBookmark = useCallback(() => {
    if (!previewBookmark) return;
    setDeleteError(null);
    removeBookmark(previewBookmark, setDeleteError);
  }, [previewBookmark, removeBookmark]);

  return (
    <Box data-testid="bookmark-library-page" sx={{ py: 0.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <AttachFileIcon sx={{ color: (theme) => theme.palette.mode === 'light' ? '#626975' : theme.palette.primary.main }} />
        <Typography variant="h5" fontWeight={700}>{t('myClips')}</Typography>
        <Typography variant="caption" color="text.secondary">{bookmarks.length}</Typography>
      </Box>
      <Tabs value={tab} onChange={(_, value: 'recent' | 'books') => setTab(value)} sx={{ mb: 2 }}>
        <Tab value="recent" label={t('recent')} />
        <Tab value="books" label={t('byBook')} />
      </Tabs>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading ? <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box> : bookmarks.length === 0 ? (
        <Box sx={{ py: 8, textAlign: 'center' }}>
          <AttachFileIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
          <Typography color="text.secondary">{t('noBookmarks')}</Typography>
          <Typography variant="body2" color="text.disabled" sx={{ mt: 0.5 }}>{t('bookmarkEmptyGuide')}</Typography>
        </Box>
      ) : tab === 'recent' ? gallery(bookmarks) : (
        <Box sx={{ display: 'grid', gap: 3 }}>
          {byBook.map((items) => (
            <Box key={`${items[0].folder}/${items[0].filename}`}>
              <Typography variant="subtitle1" fontWeight={700} noWrap translate="no" sx={{ mb: 1 }}>{bookTitle(items[0].filename)}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}><TranslatedFolderName value={items[0].folder} /> · {items.length}</Typography>
              {gallery(items)}
            </Box>
          ))}
        </Box>
      )}
      <Dialog data-testid="bookmark-preview-dialog" data-text-pane={textPaneOpen ? 'open' : 'closed'} open={Boolean(previewBookmark)} onClose={() => setPreviewBookmark(null)} transitionDuration={0} fullWidth maxWidth={textPaneOpen ? 'lg' : 'sm'}>
        {previewBookmark && <>
          <DialogTitle>{t('bookmarkCapture')}</DialogTitle>
          {/* With the text pane open the clip and its text sit side by side (stacked on a narrow screen).
              max-content rows: in the height-limited dialog, auto rows shrank the clip frame under the pane. */}
          <DialogContent sx={{ pt: 1, display: 'grid', gap: 2, gridTemplateColumns: textPaneOpen ? { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' } : '1fr', gridAutoRows: 'max-content', alignItems: 'start' }}>
            <Box data-testid="bookmark-preview-image-frame" sx={{ position: 'relative', border: `2px solid ${previewBookmark.borderColor}`, borderRadius: 1.5, overflow: 'hidden', bgcolor: '#101012' }}>
              <Box data-testid="bookmark-preview-image" component="img" src={previewBookmark.imageUrl} alt={ui("{p0} {p1}페이지 캡처", { p0: bookTitle(previewBookmark.filename), p1: previewBookmark.pageIndex + 1 })} decoding="async" sx={{ display: 'block', width: '100%', maxHeight: '58vh', objectFit: 'contain' }} />
              {previewBookmark.fillColor && <Box data-testid="bookmark-preview-color-indicator" sx={{ position: 'absolute', right: 12, bottom: 12, width: 14, height: 14, borderRadius: '50%', bgcolor: previewBookmark.fillColor, border: '1px solid rgba(255,255,255,.8)' }} />}
            </Box>
            {textPaneOpen && previewRecord ? <Box component="section" role="region" aria-labelledby="clip-text-pane-title" data-testid="clip-text-pane" sx={{ display: 'grid', gap: 1, alignContent: 'start', minWidth: 0, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, bgcolor: 'background.default' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography id="clip-text-pane-title" variant="subtitle1" component="h2" sx={{ flex: 1, fontWeight: 700 }}>{t('ocrClipTextTitle')}</Typography>
                <IconButton size="small" aria-label={t('ocrHideText')} title={t('ocrHideText')} data-testid="clip-text-pane-close" onClick={() => setTextPaneOpen(false)}><CloseIcon fontSize="small" /></IconButton>
              </Box>
              {previewOcr
                ? <OcrTextPanel testId="clip-ocr" state={previewOcr} retrying={retryingOcr} onRetry={() => void retryOcr(previewRecord)} maxHeight="52vh" />
                : <Box data-testid="clip-ocr" data-ocr-status="none" sx={{ display: 'grid', gap: 1, justifyItems: 'start' }}>
                  <Typography variant="body2" color="text.secondary">{t('ocrNotRead')}</Typography>
                  <Button variant="outlined" size="small" data-testid="clip-ocr-read" disabled={retryingOcr} startIcon={retryingOcr ? <CircularProgress size={14} /> : <NotesIcon fontSize="small" />} onClick={() => void retryOcr(previewRecord)}>{t('ocrReadNow')}</Button>
                </Box>}
            </Box> : null}
          </DialogContent>
          <DialogActions sx={{ display: 'block', px: 3, pb: 2.5 }}>
            <Box data-testid="bookmark-preview-details" sx={{ mb: 1.5, minWidth: 0 }}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', minWidth: 0 }}>
                <Typography variant="body2" fontWeight={600} noWrap translate="no" sx={{ flex: 1, minWidth: 0 }}>{bookTitle(previewBookmark.filename)}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>p. {previewBookmark.pageIndex + 1}</Typography>
              </Box>
              {previewBookmark.comment && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{previewBookmark.comment}</Typography>}
            </Box>
            {deleteError && <Alert severity="error" sx={{ mb: 1.5 }}>{deleteError}</Alert>}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
              <IconButton data-testid="bookmark-preview-delete" aria-label={t('deleteBookmark')} title={t('deleteBookmark')} color="error" onClick={removePreviewBookmark}>
                <DeleteOutlineIcon />
              </IconButton>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 1 }}>
                <Button data-testid="bookmark-preview-text" variant="outlined" startIcon={<NotesIcon />} aria-expanded={textPaneOpen} aria-controls={textPaneOpen ? 'clip-text-pane-title' : undefined} onClick={() => setTextPaneOpen((open) => !open)}>{textPaneOpen ? t('ocrHideText') : t('ocrShowText')}</Button>
                <Button data-testid="bookmark-preview-open-viewer" startIcon={<OpenInNewIcon />} variant="contained" onClick={openPreviewViewer}>{t('openPageNewWindow')}</Button>
              </Box>
            </Box>
          </DialogActions>
        </>}
      </Dialog>
    </Box>
  );
}
