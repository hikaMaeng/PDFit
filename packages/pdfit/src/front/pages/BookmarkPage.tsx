import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Tab, Tabs, Typography } from '@mui/material';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import type { BookmarkRecord } from '../../common/protocol/bookmarks/index.js';
import { listAllBookmarks } from '../api/bookmarks.js';
import { bookmarkLibraryModel } from '../model/bookmarkModel.js';
import { subscribeBookmarkChanges } from '../model/bookmarkEvents.js';
import { deleteBookmarkOptimistically } from '../model/optimisticBookmarks.js';
import { openViewer } from '../viewer/openViewer.js';

const BOOKMARK_IMAGE_HEIGHT = 150;
const BOOKMARK_CREATED_AT_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function bookTitle(filename: string) {
  return filename.replace(/\.pdf$/i, '');
}

function BookmarkCard({ bookmark, onOpen, onDelete, deleting }: { bookmark: BookmarkRecord; onOpen: (bookmark: BookmarkRecord) => void; onDelete: (bookmark: BookmarkRecord) => void; deleting: boolean }) {
  const createdAt = new Date(bookmark.createdAt);

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
        <Box component="img" src={bookmark.imageUrl} alt="" sx={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />
        <IconButton
          data-testid="bookmark-card-delete"
          aria-label="북마크 삭제"
          title="북마크 삭제"
          color="error"
          size="small"
          disabled={deleting}
          onClick={(event) => { event.stopPropagation(); onDelete(bookmark); }}
          sx={{ position: 'absolute', top: 4, right: 4, p: 0.35, bgcolor: 'rgba(10,10,12,.78)', '&:hover': { bgcolor: 'rgba(10,10,12,.96)' } }}
        >
          {deleting ? <CircularProgress size={17} /> : <DeleteOutlineIcon fontSize="small" />}
        </IconButton>
        {bookmark.fillColor && <Box data-testid="bookmark-library-color-indicator" sx={{ position: 'absolute', right: 8, bottom: 8, width: 11, height: 11, borderRadius: '50%', bgcolor: bookmark.fillColor, border: '1px solid rgba(255,255,255,.75)' }} />}
      </Box>
      <Box sx={{ display: 'grid', gridTemplateRows: 'repeat(3, 1rem)', gap: 0.35, px: 1, py: 0.75, minWidth: 0 }}>
        <Box data-testid="bookmark-card-title-row" sx={{ display: 'flex', gap: 0.75, alignItems: 'center', minWidth: 0 }}>
          <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0, color: '#f4f4f5', lineHeight: '1rem' }}>{bookTitle(bookmark.filename)}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, lineHeight: '1rem' }}>p. {bookmark.pageIndex + 1}</Typography>
        </Box>
        <Typography data-testid="bookmark-card-created-at" component="time" dateTime={createdAt.toISOString()} variant="caption" noWrap sx={{ display: 'block', color: '#71717a', lineHeight: '1rem' }}>
          {BOOKMARK_CREATED_AT_FORMATTER.format(createdAt)}
        </Typography>
        <Typography data-testid="bookmark-card-comment" variant="caption" noWrap sx={{ display: 'block', minHeight: '1rem', color: '#a1a1aa', lineHeight: '1rem' }}>
          {bookmark.comment ?? ''}
        </Typography>
      </Box>
    </Box>
  );
}

export default function BookmarkPage() {
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
      setError(caught instanceof Error ? caught.message : '북마크를 불러오지 못했습니다.');
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
        <BookmarkIcon color="primary" />
        <Typography variant="h5" fontWeight={700}>북마크</Typography>
        <Typography variant="caption" color="text.secondary">{bookmarks.length}</Typography>
      </Box>
      <Tabs value={tab} onChange={(_, value: 'recent' | 'books') => setTab(value)} sx={{ mb: 2 }}>
        <Tab value="recent" label="최근" />
        <Tab value="books" label="책별" />
      </Tabs>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading ? <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box> : bookmarks.length === 0 ? (
        <Box sx={{ py: 8, textAlign: 'center' }}>
          <BookmarkIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
          <Typography color="text.secondary">저장한 북마크가 없습니다.</Typography>
        </Box>
      ) : tab === 'recent' ? gallery(bookmarks) : (
        <Box sx={{ display: 'grid', gap: 3 }}>
          {byBook.map((items) => (
            <Box key={`${items[0].folder}/${items[0].filename}`}>
              <Typography variant="subtitle1" fontWeight={700} noWrap sx={{ mb: 1 }}>{bookTitle(items[0].filename)}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>{items[0].folder} · {items.length}</Typography>
              {gallery(items)}
            </Box>
          ))}
        </Box>
      )}
      <Dialog data-testid="bookmark-preview-dialog" open={Boolean(previewBookmark)} onClose={() => setPreviewBookmark(null)} fullWidth maxWidth="sm">
        {previewBookmark && <>
          <DialogTitle>북마크 캡처</DialogTitle>
          <DialogContent sx={{ pt: 1 }}>
            <Box data-testid="bookmark-preview-image-frame" sx={{ position: 'relative', border: `2px solid ${previewBookmark.borderColor}`, borderRadius: 1.5, overflow: 'hidden', bgcolor: '#101012' }}>
              <Box data-testid="bookmark-preview-image" component="img" src={previewBookmark.imageUrl} alt={`${bookTitle(previewBookmark.filename)} ${previewBookmark.pageIndex + 1}페이지 캡처`} sx={{ display: 'block', width: '100%', maxHeight: '58vh', objectFit: 'contain' }} />
              {previewBookmark.fillColor && <Box data-testid="bookmark-preview-color-indicator" sx={{ position: 'absolute', right: 12, bottom: 12, width: 14, height: 14, borderRadius: '50%', bgcolor: previewBookmark.fillColor, border: '1px solid rgba(255,255,255,.8)' }} />}
            </Box>
          </DialogContent>
          <DialogActions sx={{ display: 'block', px: 3, pb: 2.5 }}>
            <Box data-testid="bookmark-preview-details" sx={{ mb: 1.5, minWidth: 0 }}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', minWidth: 0 }}>
                <Typography variant="body2" fontWeight={600} noWrap sx={{ flex: 1, minWidth: 0 }}>{bookTitle(previewBookmark.filename)}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>p. {previewBookmark.pageIndex + 1}</Typography>
              </Box>
              {previewBookmark.comment && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{previewBookmark.comment}</Typography>}
            </Box>
            {deleteError && <Alert severity="error" sx={{ mb: 1.5 }}>{deleteError}</Alert>}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
              <IconButton data-testid="bookmark-preview-delete" aria-label="북마크 삭제" title="북마크 삭제" color="error" onClick={removePreviewBookmark}>
                <DeleteOutlineIcon />
              </IconButton>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                <Button data-testid="bookmark-preview-open-viewer" startIcon={<OpenInNewIcon />} variant="contained" onClick={openPreviewViewer}>새 창에서 페이지 열기</Button>
                <Button onClick={() => setPreviewBookmark(null)}>닫기</Button>
              </Box>
            </Box>
          </DialogActions>
        </>}
      </Dialog>
    </Box>
  );
}
