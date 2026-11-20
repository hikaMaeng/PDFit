import { Fragment, useEffect, useSyncExternalStore } from 'react';
import {
  Alert, AlertTitle, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, LinearProgress, List, ListItemButton, ListItemText, TextField, Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { BOOK_OUTLINE_MAX_DEPTH, BOOK_OUTLINE_MAX_ENTRIES, BOOK_OUTLINE_MAX_TITLE_LENGTH } from '../../../common/protocol/outlines/index.js';
import { usePdfitI18n } from '../../i18n/usePdfitI18n.js';
import { getOutlineModel } from '../../viewer/outlineModel.js';
import type { OutlineReader, PdfOutlineStorage } from '../../viewer/storedOutline.js';
import { RSC } from './resource.js';

const EDITOR_ID = 'pdf-outline-editor';

type Props = {
  open: boolean;
  readOutline: OutlineReader;
  storage?: PdfOutlineStorage | null;
  pageCount: number;
  /** 1-based page of the reader's current position, used to mark the current chapter. */
  currentPage: number;
  /** Moves the viewer to a 1-based page. The dialog closes itself afterwards. */
  onSelectPage: (page: number) => void;
  onClose: () => void;
};

export default function PdfOutlineDialog({ open, readOutline, storage, pageCount, currentPage, onSelectPage, onClose }: Props) {
  const { t } = usePdfitI18n();
  const model = getOutlineModel(readOutline, storage);
  useSyncExternalStore(model.subscribe, model.getVersion, model.getVersion);
  const { result, canSave, draft, error, mode, pending } = model;
  const loading = pending === 'load' || !result;
  const changing = pending === 'change';
  const messages = {
    empty: 'tocFailedEmpty', read: 'tocFailedError',
    write: RSC.VIEWER_OUTLINE_WRITE_FAILED_ALERT, invalid: RSC.VIEWER_OUTLINE_INVALID_ALERT,
  } as const;

  useEffect(() => {
    if (open) void model.load();
  }, [open, model]);

  const close = () => {
    if (changing) return;
    model.cancel();
    onClose();
  };

  // The current chapter is the last entry that starts at or before the current page.
  let currentKey: string | null = null;
  if (result?.status === 'ok' && mode === 'view') {
    let best = 0;
    for (const entry of result.entries) {
      if (entry.page !== null && entry.page <= currentPage && entry.page >= best) { best = entry.page; currentKey = entry.key; }
    }
  }

  return <Dialog open={open} onClose={close} fullWidth maxWidth="sm" aria-labelledby="pdf-outline-dialog-title" data-testid="pdf-outline-dialog">
    <DialogTitle id="pdf-outline-dialog-title">{t('tableOfContents')}</DialogTitle>
    <DialogContent dividers aria-busy={Boolean(pending)} sx={{ p: 0, minHeight: 120 }}>
      {changing && <LinearProgress aria-label={t('tableOfContents')} />}
      {error && <Alert severity="error" sx={{ m: 2 }}>{t(messages[error])}</Alert>}
      {loading ? (
        <Box role="status" data-testid="pdf-outline-loading" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, py: 5 }}>
          <CircularProgress size={22} />
          <Typography variant="body2" color="text.secondary">{t('tocLoading')}</Typography>
        </Box>
      ) : mode === 'delete' ? (
        <Alert severity="warning" sx={{ m: 2 }}>{t(RSC.VIEWER_OUTLINE_DELETE_MESSAGE)}</Alert>
      ) : mode === 'edit' ? (
        <Box component="form" id={EDITOR_ID} sx={{ p: 2 }} onSubmit={(event) => {
          event.preventDefault();
          void model.save(new FormData(event.currentTarget), pageCount);
        }}>
          <Box component="fieldset" disabled={changing} sx={{ m: 0, p: 0, border: 0, minWidth: 0 }}>
            {draft.map(({ id, entry }, index) => (
              <Box key={id} data-testid="pdf-outline-edit-row" sx={{
                display: 'grid', gridTemplateColumns: { xs: '1fr 1fr auto', sm: 'minmax(0, 1fr) 6rem 5rem auto' },
                alignItems: 'center', gap: 1, mb: 2,
              }}>
                <TextField name={`title-${id}`} label={t(RSC.VIEWER_OUTLINE_ENTRY_TITLE_LABEL)} size="small" required
                  defaultValue={entry?.title ?? ''} inputProps={{ maxLength: BOOK_OUTLINE_MAX_TITLE_LENGTH }}
                  InputLabelProps={{ shrink: true }}
                  sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }} />
                <TextField name={`page-${id}`} label={t(RSC.VIEWER_OUTLINE_ENTRY_PAGE_LABEL)} type="number" size="small"
                  defaultValue={entry ? (entry.page ?? '') : currentPage} inputProps={{ min: 1, max: pageCount, step: 1 }}
                  InputLabelProps={{ shrink: true }} />
                <TextField name={`level-${id}`} label={t(RSC.VIEWER_OUTLINE_ENTRY_LEVEL_LABEL)} type="number" size="small" required
                  defaultValue={(entry?.depth ?? 0) + 1} inputProps={{ min: 1, max: BOOK_OUTLINE_MAX_DEPTH, step: 1 }}
                  InputLabelProps={{ shrink: true }} />
                <IconButton type="button" aria-label={t(RSC.VIEWER_OUTLINE_REMOVE_ENTRY_BUTTON, { number: index + 1 })} onClick={() => model.removeRow(index)}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
            <Button type="button" disabled={changing || draft.length >= BOOK_OUTLINE_MAX_ENTRIES} onClick={model.addRow}>{t(RSC.VIEWER_OUTLINE_ADD_ENTRY_BUTTON)}</Button>
          </Box>
        </Box>
      ) : result.status === 'deleted' ? (
        <Alert severity="info" role="status" data-testid="pdf-outline-deleted" sx={{ m: 2 }}>{t(RSC.VIEWER_OUTLINE_DELETED_MESSAGE)}</Alert>
      ) : result.status === 'failed' ? (
        <Box sx={{ p: 2 }}>
          <Alert
            severity="error"
            role="alert"
            data-testid="pdf-outline-failed"
            data-reason={result.reason}
            action={result.reason === 'error' ? <Button color="inherit" size="small" disabled={changing} onClick={model.load}>{t('tocRetry')}</Button> : undefined}
          >
            <AlertTitle>{t('tocLoadFailed')}</AlertTitle>
            {t(result.reason === 'empty' ? 'tocFailedEmpty' : 'tocFailedError')}
          </Alert>
        </Box>
      ) : (
        <List dense aria-label={t('tableOfContents')} data-testid="pdf-outline-list" data-source={result.source ?? ''} sx={{ maxHeight: '64vh', overflowY: 'auto', py: 0.5 }}>
          {result.entries.map((entry) => {
            const current = entry.key === currentKey;
            return <ListItemButton
              key={entry.key}
              data-testid="pdf-outline-entry"
              data-page={entry.page ?? ''}
              data-depth={entry.depth}
              disabled={entry.page === null || changing}
              selected={current}
              aria-current={current ? 'location' : undefined}
              onClick={() => { if (entry.page !== null) { onSelectPage(entry.page); close(); } }}
              sx={{ paddingInlineStart: (theme) => theme.spacing(2 + Math.min(entry.depth, 8) * 2), py: 0.5 }}
            >
              <ListItemText
                primary={entry.title || '—'}
                primaryTypographyProps={{ variant: 'body2', fontWeight: entry.depth === 0 ? 600 : 400, sx: { overflowWrap: 'anywhere' } }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ marginInlineStart: (theme) => theme.spacing(2), flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                {entry.page ?? t('tocNoPage')}
              </Typography>
            </ListItemButton>;
          })}
        </List>
      )}
    </DialogContent>
    <DialogActions disableSpacing sx={{ flexWrap: 'wrap', gap: 0.5 }}>
      {/* Remount the controls so an edit click cannot submit the newly opened form. */}
      {mode === 'view' ? <Fragment key="view">
        {!loading && <Button onClick={model.regenerate} disabled={changing}>{t(RSC.VIEWER_OUTLINE_REGENERATE_BUTTON)}</Button>}
        {!loading && canSave && <Button onClick={model.edit} disabled={changing}>{t(RSC.VIEWER_OUTLINE_EDIT_BUTTON)}</Button>}
        {!loading && canSave && result.status === 'ok' && <Button color="error" onClick={model.confirmDelete} disabled={changing}>{t(RSC.VIEWER_OUTLINE_DELETE_BUTTON)}</Button>}
        <Box sx={{ flexGrow: 1 }} />
        <Button onClick={close} disabled={changing}>{t('close')}</Button>
      </Fragment> : <Fragment key={mode}>
        <Button onClick={model.cancel} disabled={changing}>{t('cancel')}</Button>
        {mode === 'edit'
          ? <Button variant="contained" type="submit" form={EDITOR_ID} disabled={changing || !draft.length}>{t('save')}</Button>
          : <Button variant="contained" color="error" onClick={model.remove} disabled={changing}>{t('delete')}</Button>}
      </Fragment>}
    </DialogActions>
  </Dialog>;
}
