import { useId, useSyncExternalStore } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, TextField, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import { BOOK_COMMENT_LIMIT, type CommentBook } from '../../../common/protocol/book-comments/index.js';
import { usePdfitI18n } from '../../i18n/usePdfitI18n.js';
import { bookCommentsModel as model } from './model.js';
import { COMMENT } from './resource.js';

export default function BookCommentsDialog({ book, onClose }: { book: CommentBook; onClose: () => void }) {
  const { language, t } = usePdfitI18n();
  const titleId = useId();
  const formId = useId();
  useSyncExternalStore(model.subscribe, model.getVersion, model.getVersion);
  const { loading, saving, error, mode, page } = model;
  const comment = page?.comment;
  const composing = mode === 'create' || mode === 'edit';
  const reading = mode === 'read';
  const dateFormat = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });

  return <Dialog open fullWidth maxWidth="sm" onClose={saving ? undefined : onClose} aria-labelledby={titleId}
    PaperProps={{ sx: { m: { xs: 1, sm: 4 }, width: { xs: 'calc(100% - 16px)', sm: 'calc(100% - 64px)' } } }}>
    <DialogTitle id={titleId} sx={{ display: 'flex', alignItems: 'start', gap: 1 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {t(COMMENT.BUTTON)}
        <Typography component="div" variant="body2" color="text.secondary" noWrap title={book.filename}>{book.filename}</Typography>
      </Box>
      <IconButton aria-label={t('close')} onClick={onClose} disabled={saving}><CloseIcon /></IconButton>
    </DialogTitle>
    <DialogContent dividers sx={{ minHeight: { xs: 168, sm: 220 } }} aria-busy={loading || saving}>
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
      {!loading && !composing && comment && <Box component="article" sx={{ mb: mode === 'delete' ? 2 : 0 }}>
        <Typography component="time" variant="caption" color="text.secondary" dateTime={comment.updatedAt}>{dateFormat.format(new Date(comment.updatedAt))}</Typography>
        <Typography sx={{ mt: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{comment.body}</Typography>
      </Box>}
      {mode === 'delete' && <Alert severity="warning">{t(COMMENT.DELETE_CONFIRM)}</Alert>}
    </DialogContent>
    {reading ? <>
      {page && page.total > 0 && <Stack component="nav" aria-label={t(COMMENT.BUTTON)} direction="row" spacing={1} justifyContent="center" alignItems="center" sx={{ pt: 1 }}>
        <Button disabled={loading || page.page <= 1} onClick={() => void model.load(page.page - 1)}>{t('previousPage')}</Button>
        <Typography variant="body2" aria-live="polite">{t(COMMENT.PAGE, { page: page.page, total: page.total })}</Typography>
        <Button disabled={loading || page.page >= page.total} onClick={() => void model.load(page.page + 1)}>{t('nextPage')}</Button>
      </Stack>}
      <DialogActions sx={{ flexWrap: 'wrap' }}>
        {comment && <>
          <Button color="error" disabled={loading || Boolean(error)} onClick={() => model.setMode('delete')}>{t('delete')}</Button>
          <Button disabled={loading || Boolean(error)} onClick={() => model.setMode('edit')}>{t('edit')}</Button>
        </>}
        <Button variant="contained" startIcon={<AddIcon />} disabled={loading || Boolean(error)} onClick={() => model.setMode('create')}>{t(COMMENT.CREATE)}</Button>
      </DialogActions>
    </> : <DialogActions>
      <Button disabled={saving} onClick={() => model.setMode('read')}>{t('cancel')}</Button>
      {composing
        ? <Button variant="contained" disabled={saving} type="submit" form={formId}>{t('save')}</Button>
        : <Button variant="contained" color="error" disabled={saving} onClick={() => void model.save()}>{t('delete')}</Button>}
    </DialogActions>}
  </Dialog>;
}
