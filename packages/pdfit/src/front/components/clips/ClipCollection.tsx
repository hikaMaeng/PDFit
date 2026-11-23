import { useId, useMemo, useState } from 'react';
import { Alert, Box, CircularProgress, Tab, Tabs, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import type { BookmarkRecord } from '../../../common/protocol/bookmarks/index.js';
import { usePdfitI18n, useTranslatedDisplayText } from '../../i18n/usePdfitI18n.js';
import { publishBookmarkChange } from '../../model/bookmarkEvents.js';
import { deleteBookmarkOptimistically } from '../../model/optimisticBookmarks.js';
import ClipCard, { clipBookTitle } from './ClipCard.js';
import ClipDetailDialog from './ClipDetailDialog.js';
import { useClipCollection, type ClipBook } from './useClipCollection.js';

function ClipBookGroup({ record, count }: { record: BookmarkRecord; count: number }) {
  const folder = useTranslatedDisplayText(record.folder);
  return <>
    <Typography variant="subtitle1" fontWeight={700} noWrap translate="no" sx={{ mb: 1 }}>{clipBookTitle(record.filename)}</Typography>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>{folder} · {count}</Typography>
  </>;
}

// See docs/usage.md#book-clips.
export default function ClipCollection({ book }: { book?: ClipBook }) {
  const { t } = usePdfitI18n();
  const { bookmarks, loading, error, refresh, model } = useClipCollection(book);
  const [tab, setTab] = useState<'recent' | 'books'>('recent');
  const [sort, setSort] = useState<'created' | 'page'>('created');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const previewTitleId = useId();
  const preview = bookmarks.find((record) => record.id === previewId);

  const sorted = useMemo(() => [...bookmarks].sort((left, right) =>
    (book && sort === 'page' ? left.pageIndex - right.pageIndex : 0)
    || Date.parse(right.createdAt) - Date.parse(left.createdAt)
    || left.id.localeCompare(right.id)), [book, bookmarks, sort]);

  const byBook = useMemo(() => {
    if (book || tab !== 'books') return [];
    const groups = new Map<string, BookmarkRecord[]>();
    for (const record of sorted) {
      const key = `${record.folder}\u0000${record.filename}`;
      const group = groups.get(key);
      if (group) group.push(record);
      else groups.set(key, [record]);
    }
    return [...groups.values()];
  }, [book, sorted, tab]);

  const remove = (record: BookmarkRecord) => {
    setDeleteError(null);
    if (previewId === record.id) setPreviewId(null);
    deleteBookmarkOptimistically(record, {
      upsert: (restored) => model.upsert(restored),
      remove: (id) => model.remove(id),
      failed: setDeleteError,
    });
  };

  const gallery = (items: BookmarkRecord[]) => (
    <Box data-testid="clip-gallery" sx={{ display: 'grid', gridTemplateColumns: book ? 'repeat(auto-fill, minmax(min(100%, 140px), 1fr))' : 'repeat(auto-fill, minmax(min(100%, 180px), 1fr))', gap: 1.25 }}>
      {items.map((item) => <ClipCard key={item.id} bookmark={item} onOpen={() => setPreviewId(item.id)} onDelete={remove} />)}
    </Box>
  );

  return <Box data-testid={book ? undefined : 'bookmark-library-page'} sx={{ py: 0.5 }}>
    {book ? <ToggleButtonGroup size="small" exclusive value={sort} onChange={(_, value: typeof sort | null) => { if (value) setSort(value); }} aria-label={t('clipSort')} sx={{ mb: 1.5 }}>
      <ToggleButton value="created">{t('clipSortCreated')}</ToggleButton>
      <ToggleButton value="page">{t('clipSortPage')}</ToggleButton>
    </ToggleButtonGroup> : <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <AttachFileIcon sx={{ color: (theme) => theme.palette.mode === 'light' ? '#626975' : theme.palette.primary.main }} />
        <Typography variant="h5" fontWeight={700}>{t('myClips')}</Typography>
        <Typography variant="caption" color="text.secondary">{bookmarks.length}</Typography>
      </Box>
      <Tabs value={tab} onChange={(_, value: typeof tab) => setTab(value)} sx={{ mb: 2 }}>
        <Tab value="recent" label={t('recent')} />
        <Tab value="books" label={t('byBook')} />
      </Tabs>
    </>}
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    {deleteError && <Alert severity="error" sx={{ mb: 2 }}>{deleteError}</Alert>}
    {loading && bookmarks.length === 0 ? <Box sx={{ display: 'grid', justifyContent: 'center', py: 5 }}><CircularProgress /></Box> : null}
    {!loading && !error && bookmarks.length === 0 ? <Box sx={{ py: book ? 4 : 8, textAlign: 'center' }}>
      <AttachFileIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
      <Typography color="text.secondary">{t(book ? 'clipBookEmpty' : 'noBookmarks')}</Typography>
      <Typography variant="body2" color="text.disabled" sx={{ mt: 0.5 }}>{t('bookmarkEmptyGuide')}</Typography>
    </Box> : null}
    {book || tab === 'recent' ? gallery(sorted) : <Box sx={{ display: 'grid', gap: 3 }}>
      {byBook.map((group) => <Box key={group[0].id}>
        <ClipBookGroup record={group[0]} count={group.length} />
        {gallery(group)}
      </Box>)}
    </Box>}
    {preview && <ClipDetailDialog key={preview.id} titleId={previewTitleId} record={preview} book={book} onClose={() => setPreviewId(null)} onDelete={() => remove(preview)}
      onSaved={(record) => {
        if (model.getAll().some((current) => current.id === record.id)) {
          publishBookmarkChange({ folder: record.folder, filename: record.filename, kind: 'updated', record });
        }
      }} refresh={refresh} />}
  </Box>;
}
