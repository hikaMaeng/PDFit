import { memo, useEffect, useId, useState, useSyncExternalStore } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, LinearProgress, TextField, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import DocumentScannerOutlinedIcon from '@mui/icons-material/DocumentScannerOutlined';
import { isOcrScanActive, type OcrScanJob } from '../../../common/protocol/ocr/scan.js';
import { listOcrScanPages, type OcrScanBook } from '../../api/ocr.js';
import { usePdfitI18n, type PdfitI18n } from '../../i18n/usePdfitI18n.js';
import { getOcrScanModel } from '../../model/ocrScanModel.js';
import { scanKeys, toolbarLabels } from './resource.js';

function scanNotice(job: OcrScanJob | null, requestFailed: boolean, t: PdfitI18n['t']) {
  if (requestFailed) return t(scanKeys.requestFailed);
  if (job?.status === 'failed' || job?.status === 'stopping') return t(scanKeys.failed, { page: job.failedPage ?? job.startPage });
  if (job?.status === 'completed') return t(scanKeys.completed);
  if (job?.status === 'cancelled') return t(scanKeys.cancelled);
  return null;
}

function ScanPagesDialog({ book, pageCount, revision, notice, failure, onClose }: {
  book: OcrScanBook;
  pageCount: number;
  revision: string;
  notice: string | null;
  failure: OcrScanJob['failure'];
  onClose: () => void;
}) {
  const { t } = usePdfitI18n();
  const title = useId();
  const [pages, setPages] = useState<Set<number> | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void listOcrScanPages(book, controller.signal)
      .then(({ pages: indexed }) => {
        if (controller.signal.aborted) return;
        setPages(new Set(indexed));
        setFailed(false);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [book, revision, retry]);

  const saved = t(scanKeys.saved);
  const unsaved = t(scanKeys.unsaved);
  const tileStyle = (indexed: boolean) => ({
    py: 0.75, border: '1px solid', borderRadius: 1, textAlign: 'center', fontVariantNumeric: 'tabular-nums',
    borderColor: indexed ? 'success.main' : 'divider',
    bgcolor: (theme: import('@mui/material').Theme) => indexed ? alpha(theme.palette.success.main, 0.16) : theme.palette.action.hover,
  } as const);
  return <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby={title}>
    <DialogTitle id={title}>{t(scanKeys.status)}</DialogTitle>
    <DialogContent dividers>
      {notice && <Typography variant="body2" sx={{ mb: 1 }} role="status">{notice}</Typography>}
      {failure === 'unavailable' && <Alert severity="warning" sx={{ mb: 1 }}>{t('ocrUnavailable')}</Alert>}
      {failure === 'source-changed' && <Alert severity="warning" sx={{ mb: 1 }}>{t(scanKeys.sourceChanged)}</Alert>}
      {failed && <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => setRetry(retry + 1)}>{t('retry')}</Button>}>
        {t(scanKeys.requestFailed)}
      </Alert>}
      {!pages && !failed && <Typography role="status" variant="body2">{t('loading')}</Typography>}
      {pages && !failed && <>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
          <Typography variant="caption" sx={{ ...tileStyle(true), px: 1 }}>{saved}</Typography>
          <Typography variant="caption" sx={{ ...tileStyle(false), px: 1 }}>{unsaved}</Typography>
        </Box>
        <Box component="ul" role="list" aria-label={t(scanKeys.status)} sx={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(48px, 1fr))', gap: 0.75, listStyle: 'none', m: 0, p: 0,
        }}>
          {Array.from({ length: pageCount }, (_, index) => {
            const indexed = pages.has(index);
            const page = index + 1;
            const label = t(scanKeys.pageStatus, { page, status: indexed ? saved : unsaved });
            return <Box component="li" key={page} aria-label={label} title={label} sx={tileStyle(indexed)}>{page}</Box>;
          })}
        </Box>
      </>}
    </DialogContent>
    <DialogActions><Button onClick={onClose}>{t('close')}</Button></DialogActions>
  </Dialog>;
}

// see apps/pdfit/docs/usage.md#document-scan
export const ScanControls = memo(function ScanControls({ folder, filename, pageCount }: OcrScanBook & { pageCount: number }) {
  const { t } = usePdfitI18n();
  const model = getOcrScanModel(folder, filename);
  useSyncExternalStore(model.subscribe, model.getVersion, model.getVersion);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pageInput, setPageInput] = useState('1');
  const { job, pending, failed } = model;
  const active = isOcrScanActive(job) || pending === 'start';
  const cancelling = job?.status === 'cancelling' || pending === 'cancel';
  const startPage = Number(pageInput);
  const validPage = Number.isSafeInteger(startPage) && startPage >= 1 && startPage <= pageCount;
  const error = failed || job?.status === 'failed' || job?.status === 'stopping';
  const notice = scanNotice(job, failed, t);
  const total = job?.pageCount;
  const pages = job?.activePages.join(', ');
  const progressLabel = pages && total ? t(scanKeys.progress, { pages, total }) : t(total ? scanKeys.queued : scanKeys.preparing);
  const progress = job && total && total >= job.startPage ? Math.floor(100 * job.processedPages / (total - job.startPage + 1)) : undefined;

  return <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, gap: 0.25 }}>
    <Tooltip title={error ? notice : t(scanKeys.status)} arrow describeChild>
      <IconButton size="small" color={error ? 'error' : 'default'} aria-label={t(scanKeys.status)} aria-haspopup="dialog" aria-expanded={dialogOpen}
        onClick={() => setDialogOpen(true)} sx={{ minWidth: 36, minHeight: 36, px: 0.75, py: 0.25, borderRadius: 1 }}>
        <Box component="span" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
          <DocumentScannerOutlinedIcon sx={{ fontSize: 17 }} />
          <Box component="span" lang="en" translate="no" aria-hidden="true" sx={{ fontSize: '0.625rem', lineHeight: 1, fontWeight: 500 }}>{toolbarLabels.scan}</Box>
        </Box>
      </IconButton>
    </Tooltip>
    {active ? <>
      <Tooltip title={cancelling ? t(scanKeys.cancelling) : progressLabel} arrow>
        <Box sx={{ width: 82, flexShrink: 0 }}>
          <Typography variant="caption" component="div" sx={{
            textAlign: 'center', fontVariantNumeric: 'tabular-nums', maxHeight: '2.25em', overflowY: 'auto', overflowWrap: 'anywhere',
          }}>
            {pages || '…'}
          </Typography>
          <LinearProgress variant={progress === undefined ? 'indeterminate' : 'determinate'} value={progress}
            aria-label={progressLabel} aria-valuetext={cancelling ? t(scanKeys.cancelling) : progressLabel} />
        </Box>
      </Tooltip>
      <Button size="small" color="inherit" sx={{ minWidth: 0, px: 0.5, textTransform: 'none' }} disabled={job?.status !== 'running' || cancelling}
        onClick={() => { if (job) void model.change({ id: job.id }); }}>{t('cancel')}</Button>
    </> : <Box component="form" sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}
      onSubmit={(event) => { event.preventDefault(); if (validPage) void model.change({ startPage }); }}>
      <TextField size="small" type="number" value={pageInput} onChange={(event) => setPageInput(event.target.value)}
        inputProps={{ min: 1, max: pageCount, step: 1, inputMode: 'numeric', 'aria-label': t(scanKeys.startPage),
          style: { textAlign: 'center', width: 36, padding: '3px 4px', fontSize: '0.8rem' } }}
        sx={{ '& input': { MozAppearance: 'textfield', '&::-webkit-inner-spin-button, &::-webkit-outer-spin-button': { WebkitAppearance: 'none', margin: 0 } } }} />
      <Button type="submit" size="small" color="inherit" sx={{ minWidth: 0, px: 0.5, textTransform: 'none' }} disabled={!validPage}>{t(scanKeys.start)}</Button>
    </Box>}
    {dialogOpen && <ScanPagesDialog book={model.book} pageCount={pageCount}
      revision={job ? `${job.id}:${job.status}:${job.processedPages}` : ''}
      notice={notice ?? (active ? progressLabel : null)} failure={job?.failure} onClose={() => setDialogOpen(false)} />}
  </Box>;
});
