import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import {
  Alert, AlertTitle, Box, Button, CircularProgress, IconButton, LinearProgress,
  List, ListItem, ListItemButton, ListItemText, Paper, TextField, Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import { BOOK_OUTLINE_MAX_DEPTH, BOOK_OUTLINE_MAX_ENTRIES, BOOK_OUTLINE_MAX_TITLE_LENGTH } from '../../../common/protocol/outlines/index.js';
import { useViewerPopupGeometry } from '../../hooks/useViewerPopupGeometry.js';
import { usePdfitI18n } from '../../i18n/usePdfitI18n.js';
import { getOutlineModel } from '../../viewer/outlineModel.js';
import type { OutlineReader, PdfOutlineStorage } from '../../viewer/storedOutline.js';
import { ViewerPopupCloseButton } from '../viewer-popup/ViewerPopupCloseButton.js';
import { ViewerPopupResizeHandle } from '../viewer-popup/ViewerPopupResizeHandle.js';
import { RSC } from './resource.js';

function defaultOutlineRect(bounds: { width: number }) {
  const width = 560;
  return { x: Math.max(0, Math.round((bounds.width - width) / 2)), y: 12, width, height: 660 };
}

type Props = {
  id: string;
  bookKey: string;
  open: boolean;
  readOutline: OutlineReader;
  storage?: PdfOutlineStorage | null;
  pageCount: number;
  /** 1-based page of the reader's current position, used to mark the current chapter. */
  currentPage: number;
  /** Moves the viewer to a 1-based page. The dialog closes itself afterwards. */
  onSelectPage: (page: number) => void;
  onSavePage?: (page: number) => void | Promise<void>;
  onClose: () => void;
};

export default function PdfOutlineDialog({ id, bookKey, open, readOutline, storage, pageCount, currentPage, onSelectPage, onSavePage, onClose }: Props) {
  const { t } = usePdfitI18n();
  const editorId = useId();
  const titleId = useId();
  const headingRef = useRef<HTMLDivElement>(null);
  const { popupRef, rect, moveHandleProps, resizeHandleProps } = useViewerPopupGeometry({
    kind: 'outline', bookKey, defaultRect: defaultOutlineRect, minWidth: 300, minHeight: 260, open,
  });
  const model = getOutlineModel(readOutline, storage);
  useSyncExternalStore(model.subscribe, model.getVersion, model.getVersion);
  const { result, canSave, draft, error, mode, pending } = model;
  const loading = pending === 'load' || !result;
  const [pageSave, setPageSave] = useState<'saving' | 'error' | null>(null);
  const changing = pending === 'change' || pageSave === 'saving';
  const messages = {
    empty: 'tocFailedEmpty', read: 'tocFailedError',
    write: RSC.VIEWER_OUTLINE_WRITE_FAILED_ALERT, invalid: RSC.VIEWER_OUTLINE_INVALID_ALERT,
  } as const;

  useEffect(() => {
    if (open) {
      void model.load();
      headingRef.current?.focus({ preventScroll: true });
    }
  }, [open, model]);

  const close = () => {
    if (changing) return;
    setPageSave(null);
    model.cancel();
    if (document.activeElement === document.body || popupRef.current?.contains(document.activeElement)) {
      document.getElementById(`${id}-trigger`)?.focus({ preventScroll: true });
    }
    onClose();
  };

  const selectAndSave = async (page: number) => {
    if (!onSavePage || changing) return;
    setPageSave('saving');
    try {
      await onSavePage(page);
      close();
    } catch {
      setPageSave('error');
    }
  };

  // The current chapter is the last entry that starts at or before the current page.
  let currentKey: string | null = null;
  if (result?.status === 'ok' && mode === 'view') {
    let best = 0;
    for (const entry of result.entries) {
      if (entry.page !== null && entry.page <= currentPage && entry.page >= best) { best = entry.page; currentKey = entry.key; }
    }
  }

  if (!open) return null;

  return <Paper ref={popupRef} id={id} role="dialog" aria-modal={false} aria-labelledby={titleId} data-testid="pdf-outline-dialog"
    elevation={16}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === 'Escape' && !event.defaultPrevented) close();
    }}
    sx={{
      boxSizing: 'border-box', position: 'absolute', zIndex: 26,
      left: rect.x, top: rect.y, width: rect.width, height: rect.height,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      border: 1, borderColor: 'divider', borderRadius: 2,
      bgcolor: 'background.paper', backgroundImage: 'none',
    }}
  >
    <Box dir="ltr" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
      <Box ref={headingRef} {...moveHandleProps} dir="auto" tabIndex={0} title={t(RSC.VIEWER_OUTLINE_MOVE_LABEL)}
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
        sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.75, p: 0.5, cursor: 'grab', touchAction: 'none', userSelect: 'none' }}
      >
        <DragIndicatorIcon fontSize="small" color="action" />
        <Typography id={titleId} component="h2" variant="subtitle2" fontWeight={700}>{t('tableOfContents')}</Typography>
      </Box>
      <ViewerPopupCloseButton onClose={close} disabled={changing} />
    </Box>
    <Box aria-busy={loading || changing} sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      {changing && <LinearProgress aria-label={t('tableOfContents')} />}
      {error && <Alert severity="error" sx={{ m: 2 }}>{t(messages[error])}</Alert>}
      {pageSave === 'error' && <Alert severity="error" sx={{ m: 2 }}>{t(RSC.VIEWER_OUTLINE_PAGE_SAVE_FAILED_ALERT)}</Alert>}
      {loading ? (
        <Box role="status" data-testid="pdf-outline-loading" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, py: 5 }}>
          <CircularProgress size={22} />
          <Typography variant="body2" color="text.secondary">{t('tocLoading')}</Typography>
        </Box>
      ) : mode === 'delete' ? (
        <Alert severity="warning" sx={{ m: 2 }}>{t(RSC.VIEWER_OUTLINE_DELETE_MESSAGE)}</Alert>
      ) : mode === 'edit' ? (
        <Box component="form" id={editorId} sx={{ p: 2 }} onSubmit={(event) => {
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
        <List dense aria-label={t('tableOfContents')} data-testid="pdf-outline-list" data-source={result.source ?? ''} sx={{ py: 0.5 }}>
          {result.entries.map((entry) => {
            const current = entry.key === currentKey;
            const { page } = entry;
            const saveLabel = onSavePage && page !== null ? t(RSC.VIEWER_OUTLINE_SAVE_PAGE_BUTTON, { page }) : null;
            return <ListItem key={entry.key} disablePadding sx={{ paddingInlineEnd: saveLabel ? 1 : 0 }}>
              <ListItemButton
                component="button"
                type="button"
                data-testid="pdf-outline-entry"
                data-page={page ?? ''}
                data-depth={entry.depth}
                disabled={page === null || changing}
                selected={current}
                aria-current={current ? 'location' : undefined}
                onClick={() => { if (page !== null) { onSelectPage(page); close(); } }}
                sx={{ minWidth: 0, textAlign: 'start', paddingInlineStart: (theme) => theme.spacing(2 + Math.min(entry.depth, 8) * 2), paddingInlineEnd: saveLabel ? 0.5 : 2, py: 0.5 }}
              >
                <ListItemText
                  primary={entry.title || '—'}
                  primaryTypographyProps={{ variant: 'body2', fontWeight: entry.depth === 0 ? 600 : 400, sx: { overflowWrap: 'anywhere' } }}
                />
                <Typography variant="caption" color="text.secondary" sx={{ marginInlineStart: (theme) => theme.spacing(2), flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                  {page ?? t('tocNoPage')}
                </Typography>
              </ListItemButton>
              {page !== null && saveLabel && (
                <IconButton type="button" size="small" aria-label={saveLabel} title={saveLabel} disabled={changing} onClick={() => void selectAndSave(page)}>
                  <SaveOutlinedIcon sx={{ fontSize: 16 }} />
                </IconButton>
              )}
            </ListItem>;
          })}
        </List>
      )}
    </Box>
    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.5, py: 0.75, paddingInlineStart: 1, paddingInlineEnd: 3, borderTop: 1, borderColor: 'divider' }}>
      {/* Remount the controls so an edit click cannot submit the newly opened form. */}
      {mode === 'view' ? <>
        {!loading && <Button onClick={model.regenerate} disabled={changing}>{t(RSC.VIEWER_OUTLINE_REGENERATE_BUTTON)}</Button>}
        {!loading && canSave && <Button onClick={model.edit} disabled={changing}>{t(RSC.VIEWER_OUTLINE_EDIT_BUTTON)}</Button>}
        {!loading && canSave && result.status === 'ok' && <Button color="error" onClick={model.confirmDelete} disabled={changing}>{t(RSC.VIEWER_OUTLINE_DELETE_BUTTON)}</Button>}
      </> : <Box key={mode} sx={{ display: 'flex', gap: 0.5, marginInlineStart: 'auto' }}>
        <Button onClick={model.cancel} disabled={changing}>{t('cancel')}</Button>
        {mode === 'edit'
          ? <Button variant="contained" type="submit" form={editorId} disabled={changing || !draft.length}>{t('save')}</Button>
          : <Button variant="contained" color="error" onClick={model.remove} disabled={changing}>{t('delete')}</Button>}
      </Box>}
    </Box>
    <ViewerPopupResizeHandle {...resizeHandleProps} />
  </Paper>;
}
