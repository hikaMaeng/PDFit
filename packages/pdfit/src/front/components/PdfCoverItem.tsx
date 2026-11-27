import React, { useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, IconButton, ThemeProvider, Tooltip, Typography, createTheme } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { usePdfitI18n } from '../i18n/usePdfitI18n.js';
import { isPendingUploadDriveFileId, openViewer, viewerUrl } from '../viewer/openViewer.js';
import { DRAG_TYPE } from '../layout/LNB.js';
import { LibraryDragHandle } from './LibraryDragHandle.js';
import { RSC } from './resource.js';
import TagChip from './TagChip.js';
import { formatDocumentOpenedDate, getDocumentOpenedAt, subscribeDocumentOpenHistory } from '../model/documentOpenHistory.js';
import { bookMetadataApi } from '../api/bookMetadata.js';
import { viewerStateApi } from '../api/viewerState.js';
import FavoriteToggle from './FavoriteToggle.js';
import BookClipButton from './clips/BookClipButton.js';
import BookCommentButton from './book-comments/BookCommentButton.js';
import BookFileActions from './book-file-actions/BookFileActions.js';
import BookThumbnail, { hasLocalServerCover } from './BookThumbnail.js';
import BookCoverReplaceButton from './BookCoverReplaceButton.js';
import { BookAutoTagButton, BookManageTagsButton } from './BookTagButtons.js';
import type { LibraryBookProps } from './LibraryBookItem.js';

function formatBytes(bytes?: number): string {
  if (bytes === undefined) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Two lines of 1.35em text plus the vertical padding; the overlay keeps this height even for one-line titles.
const TITLE_BAND_MIN_HEIGHT = 'calc(2.7em + 12px)';
const OVERLAY_TEXT_SX = { color: 'rgba(255,255,255,.86)', fontSize: '.75rem', lineHeight: 1.4 } as const;

export default function PdfCoverItem(props: LibraryBookProps) {
  const { language, t } = usePdfitI18n();
  const navigate = useNavigate();
  // Tag colors are chosen per theme mode; the overlay is always dark, so its tags use the dark palette.
  const overlayTheme = useMemo(() => createTheme({ palette: { mode: 'dark' } }), []);
  const pending = isPendingUploadDriveFileId(props.driveFileId);
  const [infoPinned, setInfoPinned] = useState(false);
  const [infoRequested, setInfoRequested] = useState(false);
  const [lastPage, setLastPage] = useState<number | null>(null);
  const openedAt = useSyncExternalStore(subscribeDocumentOpenHistory, () => getDocumentOpenedAt({ folder: props.folder, filename: props.filename, driveFileId: props.driveFileId }), () => null);
  const openedLabel = formatDocumentOpenedDate(openedAt, language);
  const open = () => { if (!pending) openViewer({ folder: props.folder, filename: props.filename, driveFileId: props.driveFileId }); };
  const viewerHref = viewerUrl({ folder: props.folder, filename: props.filename, driveFileId: props.driveFileId });
  const infoId = useId();
  const canReplaceCover = hasLocalServerCover(props) && !pending && Boolean(props.onManageTags);
  const hasFileActions = !props.hideFileActions && Boolean(props.onMove || props.onDelete);
  const showComments = hasFileActions || Boolean(props.onManageTags);
  const book = { folder: props.folder, filename: props.filename, driveFileId: props.driveFileId };

  // The last page is the page the viewer saved in its viewer state (the same value that reopening
  // the book restores). It is read only once the overlay is first shown, so a grid of cards does
  // not issue one request per card. The separate reading-progress record is never written by the
  // viewer, so it is not used here.
  useEffect(() => {
    if (!infoRequested || pending) return;
    let cancelled = false;
    viewerStateApi.get(props.folder, props.filename, props.driveFileId).then((state) => { if (!cancelled) setLastPage(typeof state?.page === 'number' ? state.page : null); }).catch(() => { if (!cancelled) setLastPage(null); });
    return () => { cancelled = true; };
  }, [infoRequested, openedAt, pending, props.driveFileId, props.filename, props.folder]);

  const lastPageLabel = lastPage !== null && (lastPage > 1 || openedAt) ? String(lastPage) : '—';
  const infoLabel = infoPinned ? t('hideCoverInfo') : t('showCoverInfo');
  const requestInfo = () => setInfoRequested(true);
  const dragPayload = { folder: props.folder, filename: props.filename, driveFileId: props.driveFileId };

  return <Box component="article" data-testid="pdf-cover-card" sx={{ position: 'relative', display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', border: '1px solid', borderColor: 'divider', borderRadius: 1.5, bgcolor: 'background.paper', boxShadow: '0 8px 20px rgba(0,0,0,.10)', transition: 'transform 160ms ease, border-color 160ms ease', '&:hover': { transform: 'translateY(-2px)', borderColor: 'primary.light' } }}>
    <Box
      data-testid="pdf-cover-media"
      data-info-open={infoPinned ? 'true' : 'false'}
      draggable={!pending}
      onDragStart={(event) => {
        if (pending || event.defaultPrevented || event.target !== event.currentTarget) return;
        event.dataTransfer.effectAllowed = 'copyMove';
        event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(dragPayload));
      }}
      onMouseEnter={requestInfo}
      sx={{
        position: 'relative',
        userSelect: 'none',
        '& [data-cover-info]': { opacity: infoPinned ? 1 : 0, visibility: infoPinned ? 'visible' : 'hidden' },
        // Hover only exists on pointer devices; touch devices use the info button instead.
        '@media (hover: hover)': { '&:hover [data-cover-info]': { opacity: 1, visibility: 'visible' } },
      }}
    >
      <Box component="a" href={viewerHref} draggable={false} onClick={(event) => { event.preventDefault(); open(); }} sx={{ display: 'block', color: 'inherit', textDecoration: 'none', cursor: pending ? 'wait' : 'pointer', opacity: pending ? .65 : 1 }}>
        <BookThumbnail book={props} pending={pending} />
      </Box>
      {/* Overlay layer: the info panel fills what the title band leaves; both sit on top of the thumbnail. */}
      <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', pointerEvents: 'none' }}>
        <ThemeProvider theme={overlayTheme}>
          <Box
            id={infoId}
            data-cover-info
            data-testid="pdf-cover-info-overlay"
            onClick={(event) => { if (event.target === event.currentTarget) open(); }}
            sx={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: .75, p: 1, pt: 4.5, bgcolor: 'rgba(0,0,0,.72)', pointerEvents: 'auto', cursor: pending ? 'wait' : 'pointer', transition: 'opacity 140ms ease' }}
          >
            {pending ? <Typography role="status" variant="caption" sx={{ alignSelf: 'flex-start', px: .75, py: .25, border: '1px solid', borderColor: 'warning.main', borderRadius: 99, color: 'warning.light', fontWeight: 650 }}>{t('uploadPending')}</Typography> : null}
            <Box data-testid="pdf-cover-tags" sx={{ display: 'flex', flexWrap: 'wrap', gap: .5 }}>
              {props.tags.map((tag) => <TagChip key={tag} tag={tag} color={props.tagColors[tag]} compact plain disabled={pending} onDelete={props.onTagDelete ? () => props.onTagDelete?.(props.folder, props.filename, tag) : undefined} onClick={() => navigate(`/tag/${encodeURIComponent(tag)}`)} />)}
              {props.onAutoTag && <BookAutoTagButton
                onClick={() => props.onAutoTag?.(props.folder, props.filename)}
                disabled={pending || Boolean(props.autoTagDisabled)} running={props.autoTagging} />}
            </Box>
            {props.onEditMetadata ? <span><Button size="small" data-testid="pdf-cover-document-info" disabled={pending} onMouseEnter={() => { if (props.driveFileId && !pending) bookMetadataApi.prefetch(props.driveFileId); }} onFocus={() => { if (props.driveFileId && !pending) bookMetadataApi.prefetch(props.driveFileId); }} onClick={() => props.onEditMetadata?.(props.folder, props.filename)} sx={{ minWidth: 0, p: 0, fontSize: '.75rem', color: 'primary.light', textDecoration: 'underline', textUnderlineOffset: '3px' }}>{t('documentInfo')}</Button></span> : null}
            <Typography component="time" data-testid="pdf-cover-opened-at" dateTime={openedAt ?? undefined} variant="caption" sx={OVERLAY_TEXT_SX}>{t('openedAt')}: {openedLabel}</Typography>
            <Typography data-testid="pdf-cover-last-page" variant="caption" sx={OVERLAY_TEXT_SX}>{t('lastPage')}: {lastPageLabel}</Typography>
            <Typography data-testid="pdf-cover-file-size" variant="caption" sx={OVERLAY_TEXT_SX}>{formatBytes(props.size)}</Typography>
          </Box>
        </ThemeProvider>
        <Box data-testid="pdf-cover-title-row" sx={{ flexShrink: 0, minHeight: TITLE_BAND_MIN_HEIGHT, display: 'flex', alignItems: 'center', gap: .5, px: 1, py: '6px', fontSize: '.85rem', lineHeight: 1.35, bgcolor: 'rgba(0,0,0,.62)', color: '#fff', pointerEvents: 'none' }}>
          <Typography component="a" href={viewerHref} draggable={false} onClick={(event) => { event.preventDefault(); open(); }} title={props.filename} translate="no" sx={{ minWidth: 0, flex: 1, color: '#fff', fontWeight: 700, fontSize: 'inherit', lineHeight: 'inherit', textDecoration: 'none', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere', pointerEvents: 'auto' }}>{props.filename}</Typography>
          <BookClipButton book={props} disabled={pending} />
        </Box>
      </Box>
      <FavoriteToggle folder={props.folder} filename={props.filename} variant="card" disabled={pending} />
      {!pending && <LibraryDragHandle type={DRAG_TYPE} payload={dragPayload}
        label={t(RSC.LIBRARY_BOOK_DRAG_LABEL, { name: props.filename })} testId="pdf-cover-drag-handle"
        sx={{ position: 'absolute', top: 6, left: '50%', transform: 'translateX(-50%)', zIndex: 1,
          width: 28, height: 24, borderRadius: '12px', color: '#fff', bgcolor: 'rgba(0,0,0,.55)' }} />}
      <IconButton
        data-testid="pdf-cover-info-toggle"
        aria-label={infoLabel}
        aria-expanded={infoPinned}
        aria-controls={infoId}
        size="small"
        onClick={() => { requestInfo(); setInfoPinned((value) => !value); }}
        sx={{ position: 'absolute', top: 6, right: 6, zIndex: 1, width: 24, height: 24, p: 0, color: '#fff', bgcolor: 'rgba(0,0,0,.55)', '&:hover': { bgcolor: 'rgba(0,0,0,.78)' } }}
      >
        <InfoOutlinedIcon sx={{ fontSize: 18 }} />
      </IconButton>
    </Box>
    {showComments && <Box data-testid="pdf-cover-actions" sx={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: '1fr', '& > span, & > [data-testid] > span': { display: 'flex' }, '& .MuiIconButton-root': { flex: 1, height: 36, p: 0, borderRadius: 0 } }}>
      <BookCommentButton book={book} disabled={pending} />
      <Box data-testid="pdf-cover-tag-actions" sx={{ display: 'contents' }}>
        {canReplaceCover && <BookCoverReplaceButton folder={props.folder} filename={props.filename} />}
        {props.onManageTags && <BookManageTagsButton disabled={pending} onClick={() => props.onManageTags?.(props.folder, props.filename)} />}
      </Box>
      {hasFileActions && <Box data-testid="pdf-cover-file-actions" sx={{ display: 'contents' }}>
        <BookFileActions book={book} disabled={pending} onMove={props.onMove} onDelete={props.onDelete} />
      </Box>}
    </Box>}
  </Box>;
}
