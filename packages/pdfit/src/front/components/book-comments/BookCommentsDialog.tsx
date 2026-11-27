import { useId, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Paper, Stack, TextField, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloseIcon from '@mui/icons-material/Close';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import {
  BOOK_COMMENT_IMAGE_BYTES, BOOK_COMMENT_IMAGE_LIMIT, BOOK_COMMENT_IMAGE_TYPES, BOOK_COMMENT_LIMIT,
  bookCommentImageUrl, bookCommentPageCount, type BookComment, type CommentBook,
} from '../../../common/protocol/book-comments/index.js';
import { usePdfitI18n } from '../../i18n/usePdfitI18n.js';
import { BookCommentMarkdown } from './BookCommentMarkdown.js';
import { bookCommentsModel, viewerBookCommentsModel } from './model.js';
import { COMMENT } from './resource.js';
import { useViewerPopupGeometry, viewerPopupBookKey } from '../../hooks/useViewerPopupGeometry.js';
import { VIEWER_POPUP_CLOSE_INSET, ViewerPopupCloseButton } from '../viewer-popup/ViewerPopupCloseButton.js';
import { ViewerPopupResizeHandle } from '../viewer-popup/ViewerPopupResizeHandle.js';

type BoardProps = { book: CommentBook; onClose: () => void };

function BookCommentContent({ book, comment }: { book: CommentBook; comment: BookComment }) {
  const { t } = usePdfitI18n();
  return <>
    {Boolean(comment.referencePages?.length) && <Typography variant="body2" color="text.secondary" sx={{ mb: .5, overflowWrap: 'anywhere' }}>
      {t(COMMENT.REFERENCE_PAGES)} · {comment.referencePages?.join(', ')}
    </Typography>}
    {comment.body.trim() && <BookCommentMarkdown body={comment.body} />}
    {comment.images?.map(({ id, name }) => <Box component="img" key={id} alt={name}
      src={bookCommentImageUrl(book, comment.id, id)} loading="lazy"
      sx={{ display: 'block', width: '100%', height: 'auto', mt: 1 }} />)}
  </>;
}

function BookCommentsBoard({ book, onClose, titleId, model, dragHandle }: BoardProps & {
  titleId: string;
  model: typeof bookCommentsModel;
  dragHandle?: ReturnType<typeof useViewerPopupGeometry>['moveHandleProps'];
}) {
  const { language, t } = usePdfitI18n();
  const formId = useId();
  const content = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  useSyncExternalStore(model.subscribe, model.getVersion, model.getVersion);
  const { loading, saving, error, mode, page, selectedId, draftImages, draftReferencePages, imageError, referencePagesError, filter } = model;
  const comment = page?.comments.find((entry) => entry.id === selectedId);
  const pageCount = bookCommentPageCount(page?.total ?? 0);
  const composing = mode === 'create' || mode === 'edit';
  const reading = mode === 'read';
  const dateFormat = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });

  useLayoutEffect(() => { if (content.current) content.current.scrollTop = 0; }, [mode, page?.page]);

  return <>
    <DialogTitle id={`${titleId}-heading`} sx={{ display: 'flex', direction: 'ltr', alignItems: 'center', gap: .5,
      pl: { xs: 2, sm: 3 }, paddingRight: VIEWER_POPUP_CLOSE_INSET,
      py: dragHandle ? { xs: 1, sm: 1.5 } : { xs: 1.5, sm: 2 } }}>
      <Box {...dragHandle} tabIndex={dragHandle ? 0 : undefined} title={dragHandle ? t(COMMENT.MOVE) : undefined}
        aria-keyshortcuts={dragHandle ? 'ArrowUp ArrowDown ArrowLeft ArrowRight' : undefined}
        data-testid={dragHandle ? 'viewer-comments-drag-handle' : undefined}
        sx={{ display: 'flex', alignItems: 'center', gap: .75, flex: 1, minWidth: 0, touchAction: dragHandle ? 'none' : undefined,
          cursor: dragHandle ? 'grab' : undefined, userSelect: dragHandle ? 'none' : undefined, '&:active': { cursor: dragHandle ? 'grabbing' : undefined } }}>
        {dragHandle && <DragIndicatorIcon color="action" fontSize="small" />}
        <Typography noWrap dir="auto" component="span" variant="h6" id={titleId}>{t(COMMENT.BUTTON)}</Typography>
      </Box>
      {dragHandle && <>
        <Button size="small" variant={filter === 'latest' ? 'outlined' : 'text'} aria-pressed={filter === 'latest'}
          disabled={!reading} onClick={() => model.setFilter('latest')} sx={{ minWidth: 0, flexShrink: 0 }}>{t(COMMENT.LATEST)}</Button>
        <Button size="small" variant={filter === 'current' ? 'outlined' : 'text'} aria-pressed={filter === 'current'}
          disabled={!reading} onClick={() => model.setFilter('current')} sx={{ minWidth: 0, flexShrink: 0 }}>{t(COMMENT.CURRENT_PAGE)}</Button>
      </>}
      <ViewerPopupCloseButton size="medium" onClose={onClose} disabled={saving} />
    </DialogTitle>
    <DialogContent ref={content} dividers tabIndex={0} data-testid="book-comments-content" aria-busy={loading || saving}
      sx={{ minHeight: 0, overflowY: 'auto', overscrollBehaviorY: 'contain', px: { xs: 2, sm: 3 } }}>
      {error === 'load' && <Alert severity="error" action={<Button color="inherit" onClick={model.retry}>{t('retry')}</Button>}>{t(COMMENT.LOAD_ERROR)}</Alert>}
      {error === 'save' && <Alert severity="error" sx={{ mb: 2 }}>{t(COMMENT.SAVE_ERROR)}</Alert>}
      {loading && <Box role="status" aria-label={t('loading')} sx={{ display: 'grid', placeItems: 'center', py: 4 }}><CircularProgress size={24} /></Box>}
      {composing && <Box component="form" id={formId} onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const body = form.get('body');
        const pages = form.get('referencePages');
        if (typeof body === 'string' && typeof pages === 'string') void model.save(body, pages);
      }}>
        <TextField autoFocus fullWidth multiline required={!draftImages.length} minRows={5} maxRows={12} name="body"
          label={t(COMMENT.BODY)} defaultValue={mode === 'edit' ? comment?.body : ''}
          inputProps={{ maxLength: BOOK_COMMENT_LIMIT, readOnly: saving }} />
        <TextField fullWidth name="referencePages" label={t(COMMENT.REFERENCE_PAGES)}
          defaultValue={draftReferencePages} error={referencePagesError} onChange={model.clearReferencePagesError}
          helperText={t(referencePagesError ? COMMENT.REFERENCE_PAGES_ERROR : COMMENT.REFERENCE_PAGES_HINT)}
          inputProps={{ readOnly: saving, dir: 'ltr' }} sx={{ mt: 2 }} />
        <Button startIcon={<AttachFileIcon />} disabled={saving || draftImages.length >= BOOK_COMMENT_IMAGE_LIMIT}
          onClick={() => imageInput.current?.click()} sx={{ mt: 1 }}>{t(COMMENT.ATTACH_IMAGES)}</Button>
        <input ref={imageInput} type="file" hidden multiple aria-label={t(COMMENT.ATTACH_IMAGES)}
          accept={BOOK_COMMENT_IMAGE_TYPES.join(',')} onChange={(event) => {
            model.addImages(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = '';
          }} />
        {imageError && <Alert severity="warning">{t(COMMENT.IMAGE_LIMIT, {
          count: BOOK_COMMENT_IMAGE_LIMIT, size: BOOK_COMMENT_IMAGE_BYTES / 1024 / 1024,
        })}</Alert>}
        {draftImages.length > 0 && <Stack component="ul" spacing={.5} sx={{ px: 0, my: 1, listStyle: 'none' }}>
          {draftImages.map(({ id, name }) => <Stack component="li" key={id} direction="row" alignItems="center" spacing={1}>
            <Typography variant="body2" noWrap sx={{ flex: 1 }} title={name}>{name}</Typography>
            <IconButton size="small" disabled={saving} aria-label={t(COMMENT.REMOVE_IMAGE, { name })}
              onClick={() => model.removeImage(id)}><CloseIcon fontSize="small" /></IconButton>
          </Stack>)}
        </Stack>}
      </Box>}
      {!loading && !error && page?.total === 0 && reading &&
        <Typography color="text.secondary">{t(filter === 'current' ? COMMENT.CURRENT_PAGE_EMPTY : COMMENT.EMPTY)}</Typography>}
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
        <BookCommentContent book={book} comment={entry} />
      </Box>)}
      {mode === 'delete' && comment && <Box component="article" sx={{ mb: 2 }}>
        <Typography component="time" variant="caption" color="text.secondary" dateTime={comment.updatedAt}>{dateFormat.format(new Date(comment.updatedAt))}</Typography>
        <BookCommentContent book={book} comment={comment} />
      </Box>}
      {mode === 'delete' && <Alert severity="warning">{t(COMMENT.DELETE_CONFIRM)}</Alert>}
    </DialogContent>
    {reading ? <DialogActions disableSpacing sx={{ flexWrap: 'wrap', gap: .75, pl: { xs: 1, sm: 2 },
      pr: dragHandle ? 4 : { xs: 1, sm: 2 } }}>
      {page && page.total > 0 && <Stack component="nav" aria-label={t(COMMENT.BUTTON)} direction="row" gap={.5} flexWrap="wrap" alignItems="center">
        <Button disabled={loading || page.page <= 1} onClick={() => void model.load(page.page - 1)}>{t('previousPage')}</Button>
        <Typography variant="body2" aria-live="polite">{t(COMMENT.PAGE, { page: page.page, total: pageCount })}</Typography>
        <Button disabled={loading || page.page >= pageCount} onClick={() => void model.load(page.page + 1)}>{t('nextPage')}</Button>
      </Stack>}
      <Button variant="contained" startIcon={<AddIcon />} disabled={loading || Boolean(error)} onClick={() => model.setMode('create')}
        sx={{ marginInlineStart: 'auto' }}>{t(COMMENT.CREATE)}</Button>
    </DialogActions> : <DialogActions sx={{ paddingRight: dragHandle ? 4 : undefined }}>
      <Button disabled={saving} onClick={() => model.setMode('read')}>{t('cancel')}</Button>
      {composing
        ? <Button variant="contained" disabled={saving} type="submit" form={formId}>{t('save')}</Button>
        : <Button variant="contained" color="error" disabled={saving} onClick={() => void model.save()}>{t('delete')}</Button>}
    </DialogActions>}
  </>;
}

export default function BookCommentsDialog(props: BoardProps) {
  const titleId = useId();
  return <Dialog open fullWidth maxWidth={false} onClose={() => { if (!bookCommentsModel.saving) props.onClose(); }} aria-labelledby={titleId}
    PaperProps={{ 'aria-modal': true, sx: {
      m: { xs: 1, sm: 2, md: 3 },
      width: { xs: 'calc(100% - 16px)', sm: 'calc(100% - 32px)', md: 'calc(100% - 48px)' },
      height: { xs: 'calc(100dvh - 16px)', sm: 'calc(100dvh - 32px)', md: 'calc(100dvh - 48px)' },
      maxWidth: 1200,
      maxHeight: 'none',
      overflow: 'hidden',
    } }}>
    <BookCommentsBoard {...props} titleId={titleId} model={bookCommentsModel} />
  </Dialog>;
}

export function FloatingBookComments({ id, currentPage, ...props }: BoardProps & { id: string; currentPage: number }) {
  const titleId = useId();
  useLayoutEffect(() => { viewerBookCommentsModel.setViewerPage(currentPage); }, [currentPage]);
  const { popupRef, rect, moveHandleProps, resizeHandleProps } = useViewerPopupGeometry({
    kind: 'comments', bookKey: viewerPopupBookKey(props.book), open: true,
    defaultRect: ({ width }) => ({ x: width - 480 - 8, y: 12, width: 480, height: 620 }),
    minWidth: 320, minHeight: 300,
  });
  return <Paper ref={popupRef} id={id} role="dialog" aria-modal={false} aria-labelledby={titleId} elevation={12}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === 'Escape' && !viewerBookCommentsModel.saving) props.onClose();
    }}
    sx={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height,
      boxSizing: 'border-box', zIndex: 25, display: 'flex', flexDirection: 'column',
      border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
    <BookCommentsBoard {...props} titleId={titleId} model={viewerBookCommentsModel} dragHandle={moveHandleProps} />
    <ViewerPopupResizeHandle {...resizeHandleProps} />
  </Paper>;
}
