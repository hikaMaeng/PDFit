import { useId, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, TextField, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import { BOOK_COMMENT_LIMIT, bookCommentPageCount, type CommentBook } from '../../../common/protocol/book-comments/index.js';
import { usePdfitI18n } from '../../i18n/usePdfitI18n.js';
import { bookCommentsModel as model } from './model.js';
import { COMMENT } from './resource.js';

export default function BookCommentsDialog({ book, onClose }: { book: CommentBook; onClose: () => void }) {
  const { language, t } = usePdfitI18n();
  const titleId = useId();
  const formId = useId();
  const content = useRef<HTMLDivElement>(null);
  useSyncExternalStore(model.subscribe, model.getVersion, model.getVersion);
  const { loading, saving, error, mode, page, selectedId } = model;
  const comment = page?.comments.find((entry) => entry.id === selectedId);
  const pageCount = bookCommentPageCount(page?.total ?? 0);
  const composing = mode === 'create' || mode === 'edit';
  const reading = mode === 'read';
  const dateFormat = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });

  useLayoutEffect(() => { if (content.current) content.current.scrollTop = 0; }, [mode, page?.page]);

  return <Dialog open fullWidth maxWidth={false} onClose={saving ? undefined : onClose} aria-labelledby={titleId}
    PaperProps={{ sx: {
      m: { xs: 1, sm: 2, md: 3 },
      width: { xs: 'calc(100% - 16px)', sm: 'calc(100% - 32px)', md: 'calc(100% - 48px)' },
      height: { xs: 'calc(100dvh - 16px)', sm: 'calc(100dvh - 32px)', md: 'calc(100dvh - 48px)' },
      maxWidth: 1200,
      maxHeight: 'none',
      overflow: 'hidden',
    } }}>
    <DialogTitle id={titleId} sx={{ display: 'flex', alignItems: 'start', gap: 1, px: { xs: 2, sm: 3 }, py: { xs: 1.5, sm: 2 } }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {t(COMMENT.BUTTON)}
        <Typography component="div" variant="body2" color="text.secondary" noWrap title={book.filename}>{book.filename}</Typography>
      </Box>
      <IconButton aria-label={t('close')} onClick={onClose} disabled={saving}><CloseIcon /></IconButton>
    </DialogTitle>
    <DialogContent ref={content} dividers tabIndex={0} data-testid="book-comments-content" aria-busy={loading || saving}
      sx={{ minHeight: 0, overflowY: 'auto', overscrollBehaviorY: 'contain', px: { xs: 2, sm: 3 } }}>
      {error === 'load' && <Alert severity="error" action={<Button color="inherit" onClick={model.retry}>{t('retry')}</Button>}>{t(COMMENT.LOAD_ERROR)}</Alert>}
      {error === 'save' && <Alert severity="error" sx={{ mb: 2 }}>{t(COMMENT.SAVE_ERROR)}</Alert>}
      {loading && <Box role="status" aria-label={t('loading')} sx={{ display: 'grid', placeItems: 'center', py: 4 }}><CircularProgress size={24} /></Box>}
      {composing && <Box component="form" id={formId} onSubmit={(event) => {
        event.preventDefault();
        const body = new FormData(event.currentTarget).get('body');
        if (typeof body === 'string') void model.save(body);
      }}>
        <TextField autoFocus fullWidth multiline required minRows={5} maxRows={12} name="body"
          label={t(COMMENT.BODY)} defaultValue={mode === 'edit' ? comment?.body : ''}
          inputProps={{ maxLength: BOOK_COMMENT_LIMIT, readOnly: saving }} />
      </Box>}
      {!loading && !error && page?.total === 0 && reading && <Typography color="text.secondary">{t(COMMENT.EMPTY)}</Typography>}
      {!loading && reading && page?.comments.map((entry) => <Box component="article" key={entry.id} sx={{
        py: 1.5,
        '&:first-of-type': { pt: 0 },
        '&:not(:last-of-type)': { borderBottom: '1px solid', borderColor: 'divider' },
      }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={.5}>
          <Typography component="time" variant="caption" color="text.secondary" dateTime={entry.updatedAt}>{dateFormat.format(new Date(entry.updatedAt))}</Typography>
          <Stack direction="row" spacing={.5}>
            <Button size="small" disabled={Boolean(error)} onClick={() => model.setMode('edit', entry.id)}>{t('edit')}</Button>
            <Button size="small" color="error" disabled={Boolean(error)} onClick={() => model.setMode('delete', entry.id)}>{t('delete')}</Button>
          </Stack>
        </Stack>
        <Typography sx={{ mt: .5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{entry.body}</Typography>
      </Box>)}
      {mode === 'delete' && comment && <Box component="article" sx={{ mb: 2 }}>
        <Typography component="time" variant="caption" color="text.secondary" dateTime={comment.updatedAt}>{dateFormat.format(new Date(comment.updatedAt))}</Typography>
        <Typography sx={{ mt: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{comment.body}</Typography>
      </Box>}
      {mode === 'delete' && <Alert severity="warning">{t(COMMENT.DELETE_CONFIRM)}</Alert>}
    </DialogContent>
    {reading ? <DialogActions disableSpacing sx={{ flexWrap: 'wrap', gap: .75, px: { xs: 1, sm: 2 } }}>
      {page && page.total > 0 && <Stack component="nav" aria-label={t(COMMENT.BUTTON)} direction="row" gap={.5} flexWrap="wrap" alignItems="center">
        <Button disabled={loading || page.page <= 1} onClick={() => void model.load(page.page - 1)}>{t('previousPage')}</Button>
        <Typography variant="body2" aria-live="polite">{t(COMMENT.PAGE, { page: page.page, total: pageCount })}</Typography>
        <Button disabled={loading || page.page >= pageCount} onClick={() => void model.load(page.page + 1)}>{t('nextPage')}</Button>
      </Stack>}
      <Button variant="contained" startIcon={<AddIcon />} disabled={loading || Boolean(error)} onClick={() => model.setMode('create')}
        sx={{ marginInlineStart: 'auto' }}>{t(COMMENT.CREATE)}</Button>
    </DialogActions> : <DialogActions>
      <Button disabled={saving} onClick={() => model.setMode('read')}>{t('cancel')}</Button>
      {composing
        ? <Button variant="contained" disabled={saving} type="submit" form={formId}>{t('save')}</Button>
        : <Button variant="contained" color="error" disabled={saving} onClick={() => void model.save()}>{t('delete')}</Button>}
    </DialogActions>}
  </Dialog>;
}
