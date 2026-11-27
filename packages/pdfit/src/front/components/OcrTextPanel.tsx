import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Typography } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import RefreshIcon from '@mui/icons-material/Refresh';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { usePdfitI18n } from '../i18n/usePdfitI18n.js';
import type { AiModelProgress } from '../../common/protocol/ai-model/index.js';

const modelPhaseKeys = { queued: 'aiModelQueued', running: 'aiModelRunning' } as const;

export type OcrPanelState =
  | { status: 'pending'; slowHint?: boolean; modelPhase?: AiModelProgress }
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
  renderText?: (text: string) => ReactNode;
};

type ActionProps = Pick<Props, 'state' | 'testId' | 'onRetry' | 'retrying'> & { onEdit?: () => void };

/** Shows clip OCR text with its source, copy and retry. */
export default function OcrTextPanel({ state, onRetry, retrying, testId, maxHeight, renderText }: Props) {
  const { t } = usePdfitI18n();
  return <OcrTextContent state={state} testId={testId} maxHeight={maxHeight} renderText={renderText} labelledBy={`${testId}-heading`}>
    {/* A narrow clip dialog moves whole items to the next row. */}
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1, rowGap: .5, minHeight: 30, '& > *': { flexShrink: 0 }, '& .MuiButton-root': { whiteSpace: 'nowrap' } }}>
      <Typography id={`${testId}-heading`} variant="subtitle2" component="h3" sx={{ whiteSpace: 'nowrap' }}>{t('ocrText')}</Typography>
      {state.status === 'done' ? <Chip size="small" variant="outlined" label={state.source === 'vision' ? t('ocrSourceVision') : t('ocrSourceTextLayer')} data-testid={`${testId}-source`} data-source={state.source} /> : null}
      <Box sx={{ flex: '1 0 0' }} />
      <OcrTextActions state={state} testId={testId} onRetry={onRetry} retrying={retrying} />
    </Box>
  </OcrTextContent>;
}

export function OcrTextActions({ state, onRetry, retrying = false, testId, onEdit }: ActionProps) {
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

  if (state.status === 'pending') return null;
  const copyLabel = t(copied ? 'ocrCopied' : 'ocrCopy');
  const retryLabel = t('ocrRetry');
  const editLabel = t('edit');
  return <>
    {state.status === 'done' && state.text ? <Button size="small" aria-label={copyLabel} title={copyLabel}
      startIcon={<ContentCopyIcon fontSize="small" />} onClick={() => void copy(state.text)} data-testid={`${testId}-copy`}><span className="ocr-action-label">{copyLabel}</span></Button> : null}
    {onRetry ? <Button size="small" aria-label={retryLabel} title={retryLabel}
      startIcon={retrying ? <CircularProgress size={14} /> : <RefreshIcon fontSize="small" />} disabled={retrying}
      onClick={onRetry} data-testid={`${testId}-retry`}><span className="ocr-action-label">{retryLabel}</span></Button> : null}
    {onEdit && state.status === 'done' ? <Button size="small" aria-label={editLabel} title={editLabel}
      startIcon={<EditOutlinedIcon fontSize="small" />} onClick={onEdit}><span className="ocr-action-label">{editLabel}</span></Button> : null}
  </>;
}

export function OcrTextContent({ state, testId, maxHeight = 260, renderText, children, labelledBy }: Pick<Props, 'state' | 'testId' | 'maxHeight' | 'renderText'> & { children?: ReactNode; labelledBy?: string }) {
  const { t } = usePdfitI18n();
  return <Box component="section" aria-labelledby={labelledBy} data-testid={testId} data-ocr-status={state.status}
    data-source={state.status === 'done' ? state.source : undefined} sx={{ display: 'grid', gap: 1 }}>
    {children}
    {state.status === 'pending' ? <Box role="status" sx={{ display: 'grid', gap: .5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><CircularProgress size={16} /><Typography variant="body2">{t(state.modelPhase ? modelPhaseKeys[state.modelPhase] : 'ocrReading')}</Typography></Box>
      {state.slowHint && state.modelPhase !== 'queued' ? <Typography variant="caption" color="text.secondary">{t('ocrPageSlow')}</Typography> : null}
    </Box> : null}
    {state.status === 'done' ? (state.text
      ? <Box component={renderText ? 'div' : 'pre'} data-testid={`${testId}-text`} tabIndex={0} sx={{ m: 0, p: 1.25, maxHeight, overflow: renderText ? 'hidden' : 'auto', whiteSpace: renderText ? 'normal' : 'pre-wrap', overflowWrap: 'anywhere', font: 'inherit', fontSize: '.875rem', lineHeight: 1.6, userSelect: 'text', border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'action.hover' }}>{renderText ? renderText(state.text) : state.text}</Box>
      : <Typography role="status" variant="body2" color="text.secondary" data-testid={`${testId}-empty`}>{t('ocrEmpty')}</Typography>) : null}
    {state.status === 'unavailable' ? <Alert severity="info" data-testid={`${testId}-unavailable`}>{t('ocrUnavailable')}</Alert> : null}
    {state.status === 'failed' ? <Alert severity="warning" data-testid={`${testId}-failed`}>{t('ocrFailed', { reason: state.error })}</Alert> : null}
  </Box>;
}
