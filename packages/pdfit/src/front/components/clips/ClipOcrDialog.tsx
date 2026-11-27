import { useId, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogContent, DialogTitle, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import NotesIcon from '@mui/icons-material/Notes';
import type { BookmarkRecord } from '../../../common/protocol/bookmarks/index.js';
import { retryBookmarkOcr } from '../../api/bookmarks.js';
import { usePdfitI18n } from '../../i18n/usePdfitI18n.js';
import OcrTextPanel, { type OcrPanelState } from '../OcrTextPanel.js';

function clipOcrState(ocr: BookmarkRecord['ocr']): OcrPanelState | null {
  if (!ocr) return null;
  if (ocr.status === 'done') return { status: 'done', text: ocr.text ?? '', source: ocr.source === 'vision' ? 'vision' : 'text-layer' };
  if (ocr.status === 'failed') return { status: 'failed', error: ocr.error ?? '' };
  return ocr.status === 'pending' ? { status: 'pending', modelPhase: ocr.modelPhase } : { status: ocr.status };
}

export default function ClipOcrDialog({ record, onClose, refresh }: { record: BookmarkRecord; onClose: () => void; refresh: () => Promise<void> }) {
  const { t } = usePdfitI18n();
  const titleId = useId();
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = clipOcrState(record.ocr);

  const retry = async () => {
    setRetrying(true);
    setError(null);
    try {
      await retryBookmarkOcr(record.id);
      await refresh();
    } catch (caught) {
      setError(t('ocrFailed', { reason: caught instanceof Error ? caught.message : String(caught) }));
    } finally {
      setRetrying(false);
    }
  };

  return <Dialog open hideBackdrop fullWidth maxWidth="sm" onClose={onClose} aria-labelledby={titleId} data-testid="clip-text-pane"
    PaperProps={{ sx: { maxWidth: 520, m: { xs: 2, sm: 4 }, width: { xs: 'calc(100% - 32px)', sm: 'calc(100% - 64px)' } } }}>
    <DialogTitle id={titleId} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
      {t('ocrClipTextTitle')}
      <IconButton aria-label={t('ocrHideText')} title={t('ocrHideText')} data-testid="clip-text-pane-close" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
    </DialogTitle>
    <DialogContent>
      {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}
      {state ? <OcrTextPanel testId="clip-ocr" state={state} retrying={retrying} onRetry={() => void retry()} maxHeight="52vh" />
        : <Box data-testid="clip-ocr" data-ocr-status="none" sx={{ display: 'grid', gap: 1, justifyItems: 'start' }}>
          <Typography variant="body2" color="text.secondary">{t('ocrNotRead')}</Typography>
          <Button variant="outlined" size="small" data-testid="clip-ocr-read" disabled={retrying} startIcon={retrying ? <CircularProgress size={14} /> : <NotesIcon fontSize="small" />} onClick={() => void retry()}>{t('ocrReadNow')}</Button>
        </Box>}
    </DialogContent>
  </Dialog>;
}
