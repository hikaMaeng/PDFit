import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import { usePdfitI18n } from '../i18n/usePdfitI18n.js';
import { OcrUnreachableError, recognizePageText } from '../api/ocr.js';
import OcrTextPanel, { type OcrPanelState } from './OcrTextPanel.js';

type Props = {
  open: boolean;
  folder: string;
  filename: string;
  /** 1-based page shown when the dialog was opened. */
  page: number;
  onClose: () => void;
};

/** Delay before telling the reader that a scanned page can take minutes. */
const SLOW_HINT_MS = 4_000;

/** Text of the current page: the PDF text layer, or the AI server for a scanned page. */
export default function PageOcrDialog({ open, folder, filename, page, onClose }: Props) {
  const { t } = usePdfitI18n();
  const [state, setState] = useState<OcrPanelState>({ status: 'pending' });
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const read = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: 'pending' });
    setDurationMs(null);
    const slow = window.setTimeout(() => { if (!controller.signal.aborted) setState((current) => current.status === 'pending' ? { status: 'pending', slowHint: true } : current); }, SLOW_HINT_MS);
    recognizePageText(folder, filename, page - 1, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setDurationMs(result.durationMs);
        setState(result.source === 'none' ? { status: 'unavailable' } : { status: 'done', text: result.text, source: result.source });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        // The request never reached the runtime even after the retries: say so in the
        // reader's language instead of showing the gateway's `HTTP 502`.
        const reason = error instanceof OcrUnreachableError ? t('ocrUnreachable') : error instanceof Error ? error.message : String(error);
        setState({ status: 'failed', error: reason });
      })
      .finally(() => window.clearTimeout(slow));
  }, [filename, folder, page, t]);

  useEffect(() => {
    if (!open) { abortRef.current?.abort(); return; }
    read();
    // Closing stops waiting; the server still finishes and caches the page.
    return () => abortRef.current?.abort();
  }, [open, read]);

  return <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" aria-labelledby="page-ocr-dialog-title" data-testid="page-ocr-dialog">
    <DialogTitle id="page-ocr-dialog-title">{t('ocrPageTitle', { page })}</DialogTitle>
    <DialogContent dividers>
      <Typography variant="body2" color="text.secondary" translate="no" sx={{ mb: 1.5, overflowWrap: 'anywhere' }}>{filename}</Typography>
      <OcrTextPanel testId="page-ocr" state={state} onRetry={read} maxHeight="56vh" />
    </DialogContent>
    <DialogActions>
      {durationMs !== null ? <Typography variant="caption" color="text.secondary" sx={{ mr: 'auto', pl: 1 }} data-testid="page-ocr-duration">{(durationMs / 1000).toFixed(1)} s</Typography> : <Box sx={{ mr: 'auto' }} />}
      <Button onClick={onClose}>{t('close')}</Button>
    </DialogActions>
  </Dialog>;
}
