import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Paper,
  Typography,
} from '@mui/material';
import type { ViewerStatePayload } from '../api/viewerState.js';
import {
  downloadOriginalPdf,
  originalPdfDownloadUrl,
} from '../export/documentExport.js';
import { usePdfitI18n } from '../i18n/usePdfitI18n.js';

interface DocumentExportDialogProps {
  open: boolean;
  folder: string;
  filename: string;
  driveFileId?: string | null;
  documentUrl: string;
  currentViewerState?: ViewerStatePayload | null;
  onClose: () => void;
}

/** Confirms and downloads the active PDF document. */
export default function DocumentExportDialog(props: DocumentExportDialogProps) {
  const { t } = usePdfitI18n();
  const showMobileSaveHint = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0
    && /Safari/i.test(navigator.userAgent) && !/(CriOS|FxiOS|EdgiOS|Chrome|OPiOS)/i.test(navigator.userAgent)
    && typeof (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker !== 'function';
  const hasNativeSavePicker = typeof (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setBusy(false);
    setError(null);
  }, [props.open]);

  const runDownload = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await downloadOriginalPdf(props.documentUrl, props.filename);
      if (result !== 'cancelled') props.onClose();
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : t('exportFailed'));
    } finally {
      setBusy(false);
    }
  };

  return <Dialog open={props.open} onClose={busy ? undefined : props.onClose} fullWidth maxWidth="sm" aria-labelledby="document-export-title">
    <DialogTitle id="document-export-title" sx={{ pb: 1 }}>
      <Typography component="span" variant="h6" sx={{ display: 'block', fontWeight: 800 }}>{t('exportDocument')}</Typography>
      <Typography component="span" variant="body2" color="text.secondary">{t('exportDocumentCopy')}</Typography>
    </DialogTitle>
    <DialogContent sx={{ pt: 2 }}>
      <Paper variant="outlined" sx={{ px: 1.5, py: 1.25, bgcolor: 'rgba(59,130,246,.06)' }}>
        <Typography variant="body2" fontWeight={700} noWrap translate="no">{props.filename}</Typography>
      </Paper>
      {showMobileSaveHint && <Alert severity="info" sx={{ mt: 2 }}>{t('exportMobileSaveHint')}</Alert>}
      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      {busy && <LinearProgress aria-label={t('exporting')} sx={{ mt: 2 }} />}
    </DialogContent>
    <DialogActions sx={{ px: 3, pb: 2.5 }}>
      <Button onClick={props.onClose} disabled={busy}>{t('cancel')}</Button>
      {hasNativeSavePicker
        ? <Button variant="contained" onClick={() => void runDownload()} disabled={busy}>{busy ? t('exporting') : t('export')}</Button>
        : <Button component="a" role="button" variant="contained" href={originalPdfDownloadUrl(props.documentUrl)} download={props.filename} disabled={busy}>{t('export')}</Button>}
    </DialogActions>
  </Dialog>;
}
