import { useId } from 'react';
import { Dialog, DialogContent, DialogTitle, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { usePdfitI18n } from '../../i18n/usePdfitI18n.js';
import { clipBookTitle } from './ClipCard.js';
import ClipCollection from './ClipCollection.js';
import type { ClipBook } from './useClipCollection.js';

export default function BookClipsDialog({ book, onClose }: { book: ClipBook; onClose: () => void }) {
  const { t } = usePdfitI18n();
  const titleId = useId();
  return <Dialog open fullWidth maxWidth="md" onClose={onClose} aria-labelledby={titleId} data-testid="book-clips-dialog"
    PaperProps={{ sx: { m: { xs: 1, sm: 4 }, width: { xs: 'calc(100% - 16px)', sm: 'calc(100% - 64px)' }, maxHeight: { xs: 'calc(100% - 16px)', sm: 'calc(100% - 64px)' } } }}>
    <DialogTitle id={titleId} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: { xs: 1.5, sm: 3 }, py: 1.5 }}>
      <Typography component="span" fontWeight={700} noWrap sx={{ flex: 1, minWidth: 0 }} title={book.filename}>{t('clipBookTitle', { book: clipBookTitle(book.filename) })}</Typography>
      <IconButton aria-label={t('close')} title={t('close')} onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
    </DialogTitle>
    <DialogContent sx={{ px: { xs: 1.5, sm: 3 } }}><ClipCollection book={book} /></DialogContent>
  </Dialog>;
}
