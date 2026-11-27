import React, { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { Alert, Box, Button, CircularProgress, IconButton, Paper, Portal, Typography } from '@mui/material';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import { usePdfitI18n } from '../i18n/usePdfitI18n.js';
import { OcrUnreachableError } from '../api/ocr.js';
import { pageOcrModel } from '../model/pageOcr.js';
import { useViewerPopupGeometry, viewerPopupBookKey } from '../hooks/useViewerPopupGeometry.js';
import { VIEWER_POPUP_CLOSE_INSET, ViewerPopupCloseButton } from './viewer-popup/ViewerPopupCloseButton.js';
import { RSC } from './resource.js';
import { OcrTextActions, OcrTextContent, type OcrPanelState } from './OcrTextPanel.js';
import { BookCommentMarkdown } from './book-comments/BookCommentMarkdown.js';
import { ViewerPopupResizeHandle } from './viewer-popup/ViewerPopupResizeHandle.js';

// See docs/usage.md#page-text-popup.
export default function PageOcrDialog({ folder, filename, onPage }: { folder: string; filename: string; onPage: (page: number) => void }) {
  useSyncExternalStore(pageOcrModel.subscribe, pageOcrModel.getVersion, pageOcrModel.getVersion);
  const { target } = pageOcrModel;
  if (!target || target.folder !== folder || target.filename !== filename) return null;
  const bookKey = viewerPopupBookKey({ folder, filename });
  return <PageOcrPopup key={bookKey} bookKey={bookKey} filename={filename} page={target.page} pageCount={target.pageCount} onPage={onPage} />;
}

const defaultRect = () => ({ x: 24, y: 84, width: 680, height: 550 });
const minWidth = 400;
const renderMarkdown = (text: string) => <BookCommentMarkdown body={text} />;

function PageOcrPopup({ bookKey, filename, page, pageCount, onPage }: {
  bookKey: string; filename: string; page: number; pageCount: number; onPage: (page: number) => void;
}) {
  const { t, language } = usePdfitI18n();
  const { state } = pageOcrModel;
  const { popupRef, rect, moveHandleProps, resizeHandleProps } = useViewerPopupGeometry({
    kind: 'ocr', bookKey, defaultRect, minWidth, minHeight: 280, open: true,
  });
  const moveHandleRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const editor = state.status === 'editing' ? state : null;
  const editing = editor !== null;
  useLayoutEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [page, editing]);
  useEffect(() => { if (!editing) moveHandleRef.current?.focus(); }, [editing]);
  const close = () => {
    if (editor?.saving) return;
    pageOcrModel.close();
    const trigger = document.querySelector<HTMLButtonElement>('[data-testid="page-ocr-open"]');
    trigger?.focus();
  };

  const rtl = language === 'ar';
  const jumpLabel = t(RSC.VIEWER_OCR_GO_TO_PAGE_BUTTON, { page });
  const reason = state.status === 'failed'
    ? state.error instanceof OcrUnreachableError ? t('ocrUnreachable') : String(state.error instanceof Error ? state.error.message : state.error)
    : '';
  let panel: OcrPanelState | undefined;
  if (state.status === 'pending') panel = state;
  if (state.status === 'failed' && state.during === 'scan') panel = { status: 'failed', error: reason };
  if (state.status === 'ready') {
    const { source, text } = state.result;
    panel = source === 'none' ? { status: 'unavailable' } : { status: 'done', text, source };
  }

  return <Portal><Paper ref={popupRef} role="dialog" aria-modal={false} aria-label={t('ocrPageTitle', { page })} data-testid="page-ocr-dialog" elevation={16}
    sx={{
      position: 'fixed', left: rect.x, top: rect.y, width: rect.width, height: rect.height, boxSizing: 'border-box',
      zIndex: (theme) => theme.zIndex.modal - 1, display: 'flex', flexDirection: 'column',
      border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden',
      bgcolor: 'background.paper', backgroundImage: 'none', containerType: 'inline-size', containerName: 'page-ocr',
    }}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === 'Escape' && !event.nativeEvent.isComposing) close();
    }}>
    <Box component="header" dir="ltr" sx={{
      display: 'flex', alignItems: 'center', gap: .5, pl: 1, paddingRight: VIEWER_POPUP_CLOSE_INSET,
      py: .75, borderBottom: 1, borderColor: 'divider',
    }}>
      <Box ref={moveHandleRef} {...moveHandleProps} tabIndex={0} title={t(RSC.VIEWER_OCR_MOVE_LABEL)}
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
        sx={{ flexShrink: 0, display: 'flex', alignItems: 'center', p: .5, cursor: 'grab', touchAction: 'none', userSelect: 'none' }}>
        <DragIndicatorIcon fontSize="small" color="action" />
      </Box>
      <Typography id="page-ocr-dialog-title" component="h2" variant="subtitle1" fontWeight={700}
        dir="auto" translate="no" title={filename} noWrap sx={{ flex: 1, minWidth: 0 }}>{filename}</Typography>
      <Box sx={{ display: 'flex', flexShrink: 0, alignItems: 'center', gap: .5, whiteSpace: 'nowrap' }}>
        <Typography variant="body2" component="span" color="text.secondary" aria-live="polite"
          sx={{ minWidth: `${String(pageCount).length + 2}ch`, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {t(RSC.VIEWER_OCR_PAGE_TEXT, { page })}
        </Typography>
        <Button size="small" aria-label={jumpLabel} title={jumpLabel} onClick={() => onPage(page)}
          sx={{ minWidth: 0 }}>{t('move')}</Button>
      </Box>
      <Box dir={rtl ? 'rtl' : 'ltr'} sx={{ display: 'flex', flexShrink: 0 }}>
        <IconButton size="small" aria-label={t('previousPage')} title={t('previousPage')} disabled={editing || page <= 1} onClick={() => pageOcrModel.move(-1)}>
          {rtl ? <NavigateNextIcon /> : <NavigateBeforeIcon />}
        </IconButton>
        <IconButton size="small" aria-label={t('nextPage')} title={t('nextPage')} disabled={editing || page >= pageCount} onClick={() => pageOcrModel.move(1)}>
          {rtl ? <NavigateBeforeIcon /> : <NavigateNextIcon />}
        </IconButton>
      </Box>
      <ViewerPopupCloseButton onClose={close} disabled={editor?.saving} />
    </Box>
    <Box ref={scrollRef} data-testid="page-ocr-scroll" sx={{
      display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, p: 2,
      overflow: 'auto', overscrollBehavior: 'contain',
    }}>
      {state.status === 'checking' ? (
        <Box role="status" sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <CircularProgress size={16} />
          <Typography variant="body2">{t(RSC.VIEWER_OCR_CHECKING_STATUS)}</Typography>
        </Box>
      ) : null}
      {state.status === 'unscanned' ? (
        <Box sx={{ display: 'grid', gap: 1, justifyItems: 'start' }}>
          <Typography role="status" variant="body2" color="text.secondary">{t(RSC.VIEWER_OCR_UNSCANNED_STATUS)}</Typography>
          <Button variant="outlined" onClick={pageOcrModel.scanPage}>{t(RSC.VIEWER_OCR_SCAN_BUTTON)}</Button>
        </Box>
      ) : null}
      {state.status === 'failed' && state.during === 'lookup' ? (
        <Alert severity="warning" action={<Button color="inherit" onClick={pageOcrModel.checkPage}>{t('retry')}</Button>}>{t('ocrFailed', { reason })}</Alert>
      ) : null}
      {panel ? <OcrTextContent testId="page-ocr" state={panel} maxHeight="none" renderText={renderMarkdown} labelledBy="page-ocr-dialog-title" /> : null}
      {editor ? <>
        {editor.saveError && <Alert severity="error" sx={{ mb: 1 }}>{t(editor.saveError === 'conflict' ? RSC.VIEWER_OCR_CONFLICT_ALERT : RSC.VIEWER_OCR_SAVE_ALERT)}</Alert>}
        <Box component="textarea" autoFocus aria-label={t(RSC.VIEWER_OCR_EDITOR_LABEL)} dir="auto" spellCheck={false}
          value={editor.draft} readOnly={editor.saving} onChange={(event) => pageOcrModel.changeDraft(event.target.value)}
          sx={{
            boxSizing: 'border-box', flex: 1, width: '100%', minHeight: 72, p: 1.25, resize: 'none',
            font: 'inherit', fontSize: '.875rem', lineHeight: 1.6, color: 'text.primary', bgcolor: 'background.paper',
            border: 1, borderColor: 'divider', borderRadius: 1,
          }} />
      </> : null}
    </Box>
    <Box component="footer" dir="ltr" sx={{ display: 'flex', flexShrink: 0, alignItems: 'center', justifyContent: 'flex-end',
      minHeight: 38, pl: 1, pr: 4, py: .25, borderTop: 1, borderColor: 'divider' }}>
      {editor ? <Box dir={rtl ? 'rtl' : 'ltr'} sx={{ display: 'flex', gap: .5 }}>
        <Button size="small" disabled={editor.saving} onClick={pageOcrModel.cancelEdit}>{t('cancel')}</Button>
        <Button size="small" variant="contained" disabled={editor.saving || editor.saveError === 'conflict' || editor.draft === editor.result.text}
          onClick={() => void pageOcrModel.save()}>{t(editor.saving ? 'saving' : 'save')}</Button>
      </Box> : panel ? <Box dir={rtl ? 'rtl' : 'ltr'} sx={{
        display: 'flex', flexShrink: 0, gap: .5,
        '& .MuiButton-root': { flexShrink: 0, whiteSpace: 'nowrap' },
        [`@container page-ocr (width < ${minWidth - 2}px)`]: {
          '& .ocr-action-label': { display: 'none' },
          '& .MuiButton-startIcon': { margin: 0 },
          '& .MuiButton-root': { minWidth: 36 },
        },
      }}>
        <OcrTextActions key={page} testId="page-ocr" state={panel} onRetry={pageOcrModel.scanPage}
          onEdit={state.status === 'ready' && state.result.revision ? pageOcrModel.edit : undefined} />
      </Box> : null}
    </Box>
    <ViewerPopupResizeHandle {...resizeHandleProps} />
  </Paper></Portal>;
}
