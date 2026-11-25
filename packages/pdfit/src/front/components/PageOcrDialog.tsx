import React, { useSyncExternalStore } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Typography } from '@mui/material';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import { usePdfitI18n } from '../i18n/usePdfitI18n.js';
import { OcrUnreachableError } from '../api/ocr.js';
import { pageOcrModel } from '../model/pageOcr.js';
import { RSC } from './resource.js';
import OcrTextPanel, { type OcrPanelState } from './OcrTextPanel.js';

export default function PageOcrDialog({ folder, filename }: { folder: string; filename: string }) {
  const { t, language } = usePdfitI18n();
  useSyncExternalStore(pageOcrModel.subscribe, pageOcrModel.getVersion, pageOcrModel.getVersion);
  const { target, state } = pageOcrModel;
  if (!target || target.folder !== folder || target.filename !== filename) return null;
  const { page, pageCount } = target;
  const rtl = language === 'ar';
  const reason = state.status === 'failed'
    ? state.error instanceof OcrUnreachableError ? t('ocrUnreachable') : String(state.error instanceof Error ? state.error.message : state.error)
    : '';
  let panel: OcrPanelState | undefined;
  if (state.status === 'pending') panel = { status: 'pending', slowHint: state.slowHint };
  if (state.status === 'failed' && state.during === 'scan') panel = { status: 'failed', error: reason };
  if (state.status === 'ready') {
    const { source, text } = state.result;
    panel = source === 'none' ? { status: 'unavailable' } : { status: 'done', text, source };
  }

  return <Dialog open onClose={pageOcrModel.close} fullWidth maxWidth="md" aria-labelledby="page-ocr-dialog-title" data-testid="page-ocr-dialog"
    onKeyDown={(event) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) event.stopPropagation();
    }}>
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingInlineEnd: 2 }}>
      <DialogTitle id="page-ocr-dialog-title" aria-live="polite">{t('ocrPageTitle', { page })}</DialogTitle>
      <Box dir={rtl ? 'rtl' : 'ltr'} sx={{ display: 'flex', flexShrink: 0 }}>
        <IconButton aria-label={t('previousPage')} title={t('previousPage')} disabled={page <= 1} onClick={() => pageOcrModel.move(-1)}>
          {rtl ? <NavigateNextIcon /> : <NavigateBeforeIcon />}
        </IconButton>
        <IconButton aria-label={t('nextPage')} title={t('nextPage')} disabled={page >= pageCount} onClick={() => pageOcrModel.move(1)}>
          {rtl ? <NavigateBeforeIcon /> : <NavigateNextIcon />}
        </IconButton>
      </Box>
    </Box>
    <DialogContent dividers>
      <Typography variant="body2" color="text.secondary" translate="no" sx={{ mb: 1.5, overflowWrap: 'anywhere' }}>{filename}</Typography>
      {state.status === 'checking' ? (
        <Box role="status" sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <CircularProgress size={16} />
          <Typography variant="body2">{t(RSC.VIEWER_OCR_CHECKING_STATUS)}</Typography>
        </Box>
      ) : null}
      {state.status === 'unscanned' ? (
        <Box sx={{ display: 'grid', gap: 1, justifyItems: 'start' }}>
          <Typography role="status" variant="body2" color="text.secondary">{t(RSC.VIEWER_OCR_UNSCANNED_STATUS)}</Typography>
          <Button variant="outlined" onClick={pageOcrModel.scanPage}>{t(RSC.VIEWER_OCR_SCAN_BUTTON)}</Button>
        </Box>
      ) : null}
      {state.status === 'failed' && state.during === 'lookup' ? (
        <Alert severity="warning" action={<Button color="inherit" onClick={pageOcrModel.checkPage}>{t('retry')}</Button>}>{t('ocrFailed', { reason })}</Alert>
      ) : null}
      {panel ? <OcrTextPanel key={page} testId="page-ocr" state={panel} onRetry={pageOcrModel.scanPage} maxHeight="56vh" /> : null}
    </DialogContent>
    <DialogActions>
      {state.status === 'ready' ? <Typography variant="caption" color="text.secondary" sx={{ mr: 'auto', pl: 1 }} data-testid="page-ocr-duration">{(state.result.durationMs / 1000).toFixed(1)} s</Typography> : <Box sx={{ mr: 'auto' }} />}
      <Button onClick={pageOcrModel.close}>{t('close')}</Button>
    </DialogActions>
  </Dialog>;
}
