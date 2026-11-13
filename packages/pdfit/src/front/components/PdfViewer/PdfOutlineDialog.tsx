import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, AlertTitle, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  List, ListItemButton, ListItemText, Typography,
} from '@mui/material';
import { usePdfitI18n } from '../../i18n/usePdfitI18n.js';
import type { PdfOutlineResult } from '../../viewer/pdfOutline.js';

type Props = {
  open: boolean;
  /** Reads the open document's outline. Called each time the dialog opens; the caller may cache. */
  loadOutline: () => Promise<PdfOutlineResult>;
  /** 1-based page of the reader's current position, used to mark the current chapter. */
  currentPage: number;
  /** Moves the viewer to a 1-based page. The dialog closes itself afterwards. */
  onSelectPage: (page: number) => void;
  onClose: () => void;
};

type DialogState = { status: 'loading' } | PdfOutlineResult;

/** The table of contents of the open PDF. A PDF without a readable outline shows a lookup failure. */
export default function PdfOutlineDialog({ open, loadOutline, currentPage, onSelectPage, onClose }: Props) {
  const { t } = usePdfitI18n();
  const [state, setState] = useState<DialogState>({ status: 'loading' });
  /** Incremented per load so a late answer from an earlier open cannot overwrite a newer one. */
  const requestRef = useRef(0);

  const load = useCallback(() => {
    const request = ++requestRef.current;
    setState({ status: 'loading' });
    loadOutline()
      .catch((): PdfOutlineResult => ({ status: 'failed', reason: 'error' }))
      .then((result) => { if (request === requestRef.current) setState(result); });
  }, [loadOutline]);

  useEffect(() => {
    if (!open) { requestRef.current += 1; return; }
    load();
  }, [open, load]);

  // The current chapter is the last entry that starts at or before the current page.
  let currentKey: string | null = null;
  if (state.status === 'ok') {
    let best = 0;
    for (const entry of state.entries) {
      if (entry.page !== null && entry.page <= currentPage && entry.page >= best) { best = entry.page; currentKey = entry.key; }
    }
  }

  return <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="pdf-outline-dialog-title" data-testid="pdf-outline-dialog">
    <DialogTitle id="pdf-outline-dialog-title">{t('tableOfContents')}</DialogTitle>
    <DialogContent dividers sx={{ p: 0, minHeight: 120 }}>
      {state.status === 'loading' ? (
        <Box role="status" data-testid="pdf-outline-loading" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, py: 5 }}>
          <CircularProgress size={22} />
          <Typography variant="body2" color="text.secondary">{t('tocLoading')}</Typography>
        </Box>
      ) : state.status === 'failed' ? (
        <Box sx={{ p: 2 }}>
          <Alert
            severity="error"
            role="alert"
            data-testid="pdf-outline-failed"
            data-reason={state.reason}
            action={state.reason === 'error' ? <Button color="inherit" size="small" onClick={load}>{t('tocRetry')}</Button> : undefined}
          >
            <AlertTitle>{t('tocLoadFailed')}</AlertTitle>
            {state.reason === 'empty' ? t('tocFailedEmpty') : t('tocFailedError')}
          </Alert>
        </Box>
      ) : (
        <List dense aria-label={t('tableOfContents')} data-testid="pdf-outline-list" data-source={state.source ?? ''} sx={{ maxHeight: '64vh', overflowY: 'auto', py: 0.5 }}>
          {state.entries.map((entry) => {
            const current = entry.key === currentKey;
            return <ListItemButton
              key={entry.key}
              data-testid="pdf-outline-entry"
              data-page={entry.page ?? ''}
              data-depth={entry.depth}
              disabled={entry.page === null}
              selected={current}
              aria-current={current ? 'location' : undefined}
              onClick={() => { if (entry.page !== null) { onSelectPage(entry.page); onClose(); } }}
              sx={{ pl: 2 + Math.min(entry.depth, 8) * 2, py: 0.5 }}
            >
              <ListItemText
                primary={entry.title || '—'}
                primaryTypographyProps={{ variant: 'body2', fontWeight: entry.depth === 0 ? 600 : 400, sx: { overflowWrap: 'anywhere' } }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ ml: 2, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                {entry.page ?? t('tocNoPage')}
              </Typography>
            </ListItemButton>;
          })}
        </List>
      )}
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose}>{t('close')}</Button>
    </DialogActions>
  </Dialog>;
}
