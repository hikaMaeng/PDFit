import React, { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Typography } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import RefreshIcon from '@mui/icons-material/Refresh';
import { usePdfitI18n } from '../i18n/usePdfitI18n.js';

export type OcrPanelState =
  | { status: 'pending'; slowHint?: boolean }
  | { status: 'done'; text: string; source: 'text-layer' | 'vision' }
  | { status: 'unavailable' }
  | { status: 'failed'; error: string };

type Props = {
  state: OcrPanelState;
  onRetry?: () => void;
  retrying?: boolean;
  /** Prefix for data-testid hooks, e.g. `clip-ocr` or `page-ocr`. */
  testId: string;
  maxHeight?: number | string;
};

/** Shows text read from a clip or a page, with its source, copy and retry. */
export default function OcrTextPanel({ state, onRetry, retrying = false, testId, maxHeight = 260 }: Props) {
  const { t } = usePdfitI18n();
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked: the text stays selectable */ }
  };

  const retryButton = onRetry
    ? <Button size="small" startIcon={retrying ? <CircularProgress size={14} /> : <RefreshIcon fontSize="small" />} disabled={retrying || state.status === 'pending'} onClick={onRetry} data-testid={`${testId}-retry`}>{t('ocrRetry')}</Button>
    : null;

  return <Box component="section" aria-labelledby={`${testId}-heading`} data-testid={testId} data-ocr-status={state.status} sx={{ display: 'grid', gap: 1 }}>
    {/* Each item keeps its one line; a narrow screen moves whole items to the next row. */}
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1, rowGap: .5, minHeight: 30, '& > *': { flexShrink: 0 }, '& .MuiButton-root': { whiteSpace: 'nowrap' } }}>
      <Typography id={`${testId}-heading`} variant="subtitle2" component="h3" sx={{ whiteSpace: 'nowrap' }}>{t('ocrText')}</Typography>
      {state.status === 'done' ? <Chip size="small" variant="outlined" label={state.source === 'vision' ? t('ocrSourceVision') : t('ocrSourceTextLayer')} data-testid={`${testId}-source`} data-source={state.source} /> : null}
      <Box sx={{ flex: '1 0 0' }} />
      {state.status === 'done' && state.text ? <Button size="small" startIcon={<ContentCopyIcon fontSize="small" />} onClick={() => void copy(state.text)} data-testid={`${testId}-copy`}>{copied ? t('ocrCopied') : t('ocrCopy')}</Button> : null}
      {state.status !== 'pending' ? retryButton : null}
    </Box>
    {state.status === 'pending' ? <Box role="status" sx={{ display: 'grid', gap: .5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><CircularProgress size={16} /><Typography variant="body2">{t('ocrReading')}</Typography></Box>
      {state.slowHint ? <Typography variant="caption" color="text.secondary">{t('ocrPageSlow')}</Typography> : null}
    </Box> : null}
    {state.status === 'done' ? (state.text
      ? <Box component="pre" data-testid={`${testId}-text`} tabIndex={0} sx={{ m: 0, p: 1.25, maxHeight, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', font: 'inherit', fontSize: '.875rem', lineHeight: 1.6, userSelect: 'text', border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'action.hover' }}>{state.text}</Box>
      : <Typography role="status" variant="body2" color="text.secondary" data-testid={`${testId}-empty`}>{t('ocrEmpty')}</Typography>) : null}
    {state.status === 'unavailable' ? <Alert severity="info" data-testid={`${testId}-unavailable`}>{t('ocrUnavailable')}</Alert> : null}
    {state.status === 'failed' ? <Alert severity="warning" data-testid={`${testId}-failed`}>{t('ocrFailed', { reason: state.error })}</Alert> : null}
  </Box>;
}
