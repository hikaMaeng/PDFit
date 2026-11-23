import { useState } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogContent, DialogTitle, IconButton, TextField, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import NotesIcon from '@mui/icons-material/Notes';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import type { BookmarkRecord } from '../../../common/protocol/bookmarks/index.js';
import { updateBookmark } from '../../api/bookmarks.js';
import { usePdfitI18n } from '../../i18n/usePdfitI18n.js';
import { openViewer } from '../../viewer/openViewer.js';
import { clipBookTitle } from './ClipCard.js';
import ClipOcrDialog from './ClipOcrDialog.js';
import type { ClipBook } from './useClipCollection.js';

type Props = {
  titleId: string;
  record: BookmarkRecord;
  book?: ClipBook;
  onClose: () => void;
  onDelete: () => void;
  onSaved: (record: BookmarkRecord) => void;
  refresh: () => Promise<void>;
};

export default function ClipDetailDialog({ titleId, record, book, onClose, onDelete, onSaved, refresh }: Props) {
  const { t, ui } = usePdfitI18n();
  const [ocrOpen, setOcrOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const storedMemo = record.comment ?? '';
  const memo = draft ?? storedMemo;
  const dirty = memo !== storedMemo;
  const page = record.pageIndex + 1;
  const title = clipBookTitle(record.filename);
  const pending = record.id.startsWith('pending-bookmark-');

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      onSaved(await updateBookmark(record.id, { comment: memo || null }));
      setDraft((latest) => latest === memo ? null : latest);
    } catch {
      setError(t('clipMemoSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return <>
    <Dialog open hideBackdrop={Boolean(book)} fullWidth maxWidth="sm" onClose={onClose} aria-labelledby={titleId} data-testid="bookmark-preview-dialog"
      PaperProps={{ sx: { m: { xs: 1.5, sm: 4 }, width: { xs: 'calc(100% - 24px)', sm: 'calc(100% - 64px)' }, maxHeight: { xs: 'calc(100% - 24px)', sm: 'calc(100% - 64px)' } } }}>
      <DialogTitle id={titleId} sx={{ display: 'flex', alignItems: 'center', gap: { xs: .5, sm: 1 }, px: { xs: 1.5, sm: 3 }, py: 1.5 }}>
        <Typography component="span" noWrap translate="no" title={record.filename} fontWeight={700} sx={{ flex: 1, minWidth: 0 }}>{title}</Typography>
        <Typography component="span" variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>{t('clipPage', { page })}</Typography>
        <IconButton data-testid="bookmark-preview-text" aria-label={t('ocrShowText')} aria-haspopup="dialog" title={t('ocrShowText')} size="small" disabled={pending} onClick={() => setOcrOpen(true)}><NotesIcon fontSize="small" /></IconButton>
        <IconButton data-testid="bookmark-preview-delete" aria-label={t('deleteBookmark')} title={t('deleteBookmark')} color="error" size="small" disabled={pending || saving} onClick={onDelete}><DeleteOutlineIcon fontSize="small" /></IconButton>
        <IconButton data-testid="bookmark-preview-open-viewer" aria-label={t('openPageNewWindow')} title={t('openPageNewWindow')} color="primary" size="small" onClick={() => openViewer({ folder: record.folder, filename: record.filename, driveFileId: book?.driveFileId, page })}><OpenInNewIcon fontSize="small" /></IconButton>
        <IconButton aria-label={t('close')} title={t('close')} size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
      </DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2, alignContent: 'start', px: { xs: 1.5, sm: 3 } }}>
        <Box data-testid="bookmark-preview-image-frame" sx={{ position: 'relative', border: `2px solid ${record.borderColor}`, borderRadius: 1.5, overflow: 'hidden', bgcolor: '#101012' }}>
          <Box data-testid="bookmark-preview-image" component="img" src={record.imageUrl} alt={ui("{p0} {p1}페이지 캡처", { p0: title, p1: page })} decoding="async" sx={{ display: 'block', width: '100%', maxHeight: '50vh', objectFit: 'contain' }} />
          {record.fillColor && <Box data-testid="bookmark-preview-color-indicator" sx={{ position: 'absolute', right: 12, bottom: 12, width: 14, height: 14, borderRadius: '50%', bgcolor: record.fillColor, border: '1px solid rgba(255,255,255,.8)' }} />}
        </Box>
        <TextField
          label={t('clipMemo')}
          fullWidth multiline minRows={3} maxRows={8} value={memo}
          onChange={(event) => setDraft(event.target.value)}
        />
        {error && <Alert severity="error">{error}</Alert>}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
          <Button disabled={!dirty || saving} onClick={() => { setDraft(null); setError(null); }}>{t('clipMemoReset')}</Button>
          <Button variant="contained" disabled={!dirty || pending || saving} startIcon={saving ? <CircularProgress size={14} /> : undefined} onClick={() => void save()}>{t('save')}</Button>
        </Box>
      </DialogContent>
    </Dialog>
    {ocrOpen && <ClipOcrDialog record={record} onClose={() => setOcrOpen(false)} refresh={refresh} />}
  </>;
}
