import { Box, Checkbox, useTheme } from '@mui/material';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import { useNavigate } from 'react-router-dom';
import { DEFAULT_TAG_ICON } from '../../shared/tagDetails.js';
import { usePdfitI18n, useTranslatedDisplayText } from '../i18n/usePdfitI18n.js';
import { DRAG_TYPE } from '../layout/LNB.js';
import { isPendingUploadDriveFileId, openViewer, viewerUrl } from '../viewer/openViewer.js';
import BookCommentButton from './book-comments/BookCommentButton.js';
import { BookFileButtons, BookRenameButton } from './book-file-actions/BookFileActions.js';
import BookClipButton from './clips/BookClipButton.js';
import BookCoverReplaceButton from './BookCoverReplaceButton.js';
import { BookAutoTagButton, BookManageTagsButton } from './BookTagButtons.js';
import BookThumbnail, { hasLocalServerCover } from './BookThumbnail.js';
import FavoriteToggle from './FavoriteToggle.js';
import type { LibraryBookProps } from './LibraryBookItem.js';
import { PDF_LIST_GRID_SX } from './PdfListHeader.js';
import TagChip from './TagChip.js';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FolderLocation({ folder, onClick }: { folder: string; onClick: NonNullable<LibraryBookProps['onOpenFolder']> }) {
  const { t } = usePdfitI18n();
  const label = useTranslatedDisplayText(folder);
  return <Box component="button" type="button" data-testid="pdf-folder-location"
    aria-label={`${t('folderLocation')}: ${label}`} onClick={(event) => onClick(folder, event)}
    sx={{ display: 'inline-flex', alignItems: 'center', gap: .5, px: .75, border: '1px solid', borderColor: 'divider',
      borderRadius: 1, bgcolor: 'action.hover', color: 'text.secondary', cursor: 'pointer', font: 'inherit' }}>
    <FolderOutlinedIcon sx={{ fontSize: 13, color: 'primary.main' }} />
    {label}
  </Box>;
}

export default function PdfListItem(props: LibraryBookProps) {
  const { t } = usePdfitI18n();
  const theme = useTheme();
  const navigate = useNavigate();
  const { folder, filename, driveFileId, tags, tagColors, tagIcons, onSelectionChange, onOpenFolder } = props;
  const book = { folder, filename, driveFileId };
  const pending = isPendingUploadDriveFileId(driveFileId);
  const hasFileActions = !props.hideFileActions && Boolean(props.onMove || props.onDelete);
  const showComments = hasFileActions || Boolean(props.onManageTags);
  const canReplaceCover = hasLocalServerCover(props) && !pending && Boolean(props.onManageTags);

  return <Box component="li" className="pdfit-pdf-row" data-selected={props.selected || undefined} sx={{
    ...PDF_LIST_GRID_SX, position: 'relative', boxSizing: 'border-box', minHeight: 62, py: .5, rowGap: .25,
    borderBottom: '1px solid', borderColor: 'divider', contentVisibility: 'auto', containIntrinsicSize: 'auto 62px',
  }}>
    <Box sx={{ gridArea: 'cover', alignSelf: 'stretch', position: 'relative' }}>
      <Box sx={{ position: 'absolute', inset: 0 }}>
        <BookThumbnail book={props} pending={pending} compact />
      </Box>
      {onSelectionChange && <Checkbox size="small" checked={Boolean(props.selected)} disabled={pending}
        onChange={(_, selected) => onSelectionChange(folder, filename, selected)}
        inputProps={{ 'aria-label': `${t('selectPdf')}: ${filename}`, 'data-testid': 'pdf-selection-checkbox',
          className: 'pdfit-row-selection' } as React.InputHTMLAttributes<HTMLInputElement>}
        sx={{ position: 'absolute', top: 1, insetInlineStart: 1, width: 24, height: 24, p: 0, borderRadius: .5,
          color: 'common.white', bgcolor: 'rgba(0,0,0,.63)', '&:hover': { bgcolor: 'rgba(0,0,0,.8)' } }} />}
    </Box>
    <Box sx={{ gridArea: 'name', minWidth: 0 }}>
      <Box data-testid="pdf-filename-line" sx={{ display: 'flex', alignItems: 'center', gap: .5, minWidth: 0 }}>
        <FavoriteToggle folder={folder} filename={filename} variant="row" disabled={pending} />
        <Box component="a" href={viewerUrl(book)}
          title={pending ? t('pdfStillUploading') : filename} aria-disabled={pending || undefined} translate="no" draggable={!pending}
          sx={{ minWidth: 0, color: 'inherit', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontFamily: theme.typography.fontFamily, fontWeight: theme.palette.mode === 'light' ? 550 : 400,
            letterSpacing: theme.typography.body2.letterSpacing, cursor: pending ? 'wait' : 'pointer', opacity: pending ? .72 : 1 }}
          onDragStart={(event) => {
            if (pending) { event.preventDefault(); return; }
            event.dataTransfer.effectAllowed = 'copyMove';
            event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(book));
          }}
          onClick={(event) => {
            if (pending) { event.preventDefault(); return; }
            if (event.button !== 0 || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            openViewer(book);
          }}>
          {filename}
        </Box>
        {hasFileActions && <BookRenameButton book={book} disabled={pending} />}
      </Box>
      {(tags.length > 0 || props.onAutoTag || props.onManageTags) && <Box data-testid="pdf-tag-values"
        sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: .5, minWidth: 0 }}>
        {tags.map((tag) => <TagChip key={tag} tag={tag} color={tagColors[tag]} glyph={tagIcons[tag] ?? DEFAULT_TAG_ICON} compact plain disabled={pending}
          onDelete={props.onTagDelete ? () => props.onTagDelete?.(folder, filename, tag) : undefined}
          onClick={() => navigate(`/tag/${encodeURIComponent(tag)}`)} />)}
        {(props.onAutoTag || props.onManageTags) && <Box data-testid="pdf-tag-actions" sx={{ display: 'flex', alignItems: 'center', gap: .25 }}>
          {props.onAutoTag && <BookAutoTagButton disabled={pending || Boolean(props.autoTagDisabled)} running={props.autoTagging}
            onClick={() => props.onAutoTag?.(folder, filename)} />}
          {props.onManageTags && <BookManageTagsButton disabled={pending} onClick={() => props.onManageTags?.(folder, filename)} />}
        </Box>}
      </Box>}
      {(pending || onOpenFolder) && <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: .5, pt: .25, fontSize: '.75rem' }}>
        {pending && <Box role="status" sx={{ px: .75, py: .25, border: '1px solid', borderColor: 'warning.main',
          borderRadius: 99, color: 'warning.main', fontWeight: 650 }}>{t('uploadPending')}</Box>}
        {onOpenFolder && <FolderLocation folder={folder} onClick={onOpenFolder} />}
      </Box>}
    </Box>
    <Box component="span" data-testid="pdf-file-size" sx={{ gridArea: 'size', color: 'text.secondary', fontSize: '.75rem' }}>
      {props.size === undefined ? '—' : formatBytes(props.size)}
    </Box>
    <Box role="group" aria-label={t('fileActions')} sx={{
      gridArea: 'actions', display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
      '& .MuiIconButton-root': { width: 36, height: 36, p: 0 },
    }}>
      {showComments && <BookCommentButton book={book} disabled={pending} />}
      <BookClipButton book={props} disabled={pending} />
      {canReplaceCover && <BookCoverReplaceButton folder={folder} filename={filename} />}
      {hasFileActions && <BookFileButtons book={book} disabled={pending} onMove={props.onMove} onDelete={props.onDelete} />}
    </Box>
  </Box>;
}
