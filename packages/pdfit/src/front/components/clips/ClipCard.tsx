import { Box, CircularProgress, IconButton, Typography } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import NotesIcon from '@mui/icons-material/Notes';
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined';
import type { BookmarkRecord } from '../../../common/protocol/bookmarks/index.js';
import { usePdfitI18n } from '../../i18n/usePdfitI18n.js';

const BOOKMARK_IMAGE_HEIGHT = 150;

export function clipBookTitle(filename: string) {
  return filename.replace(/\.pdf$/i, '');
}

function ClipOcrBadge({ status }: { status: NonNullable<BookmarkRecord['ocr']>['status'] }) {
  const { t } = usePdfitI18n();
  const label = status === 'pending' ? t('ocrReading') : status === 'done' ? t('ocrClipHasText') : t('ocrClipNeedsAttention');
  return <Box data-testid="bookmark-card-ocr" data-ocr-status={status} role="img" aria-label={label} title={label} sx={{ position: 'absolute', top: 6, left: 6, display: 'grid', placeItems: 'center', width: 24, height: 24, borderRadius: '50%', color: status === 'done' ? '#fff' : status === 'pending' ? '#d4d4d8' : '#fbbf24', bgcolor: 'rgba(10,10,12,.78)' }}>
    {status === 'pending' ? <CircularProgress size={13} color="inherit" /> : status === 'done' ? <NotesIcon sx={{ fontSize: 15 }} /> : <ReportProblemOutlinedIcon sx={{ fontSize: 15 }} />}
  </Box>;
}

export default function ClipCard({ bookmark, onOpen, onDelete }: { bookmark: BookmarkRecord; onOpen: (bookmark: BookmarkRecord) => void; onDelete: (bookmark: BookmarkRecord) => void }) {
  const { language, t } = usePdfitI18n();
  const createdAt = new Date(bookmark.createdAt);
  const createdAtLabel = new Intl.DateTimeFormat(language, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(createdAt);

  return (
    <Box
      component="article"
      role="button"
      tabIndex={0}
      data-testid="bookmark-library-card"
      onClick={() => onOpen(bookmark)}
      onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onOpen(bookmark); } }}
      sx={{ display: 'block', minWidth: 0, p: 0, overflow: 'hidden', textAlign: 'left', cursor: 'pointer', border: `2px solid ${bookmark.borderColor}`, borderRadius: 1.5, bgcolor: '#242426', color: 'inherit', '&:hover': { transform: 'translateY(-1px)', boxShadow: 3 } }}
    >
      <Box
        data-testid="bookmark-library-image-frame"
        sx={{
          position: 'relative',
          height: BOOKMARK_IMAGE_HEIGHT,
          minHeight: BOOKMARK_IMAGE_HEIGHT,
          maxHeight: BOOKMARK_IMAGE_HEIGHT,
          overflow: 'hidden',
          bgcolor: '#101012',
        }}
      >
        <Box component="img" src={bookmark.imageUrl} alt="" loading="lazy" decoding="async" sx={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />
        <IconButton
          data-testid="bookmark-card-delete"
          aria-label={t('deleteBookmark')}
          title={t('deleteBookmark')}
          color="error"
          size="small"
          onClick={(event) => { event.stopPropagation(); onDelete(bookmark); }}
          sx={{ position: 'absolute', top: 4, right: 4, p: 0.35, bgcolor: 'rgba(10,10,12,.78)', '&:hover': { bgcolor: 'rgba(10,10,12,.96)' } }}
        >
          <DeleteOutlineIcon fontSize="small" />
        </IconButton>
        {bookmark.ocr ? <ClipOcrBadge status={bookmark.ocr.status} /> : null}
        {bookmark.fillColor && <Box data-testid="bookmark-library-color-indicator" sx={{ position: 'absolute', right: 8, bottom: 8, width: 11, height: 11, borderRadius: '50%', bgcolor: bookmark.fillColor, border: '1px solid rgba(255,255,255,.75)' }} />}
      </Box>
      <Box sx={{ display: 'grid', gridTemplateRows: 'repeat(3, 1rem)', gap: 0.35, px: 1, py: 0.75, minWidth: 0 }}>
        <Box data-testid="bookmark-card-title-row" sx={{ display: 'flex', gap: 0.75, alignItems: 'center', minWidth: 0 }}>
          <Typography variant="caption" noWrap translate="no" sx={{ flex: 1, minWidth: 0, color: 'text.primary', lineHeight: '1rem' }}>{clipBookTitle(bookmark.filename)}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, lineHeight: '1rem' }}>{t('clipPage', { page: bookmark.pageIndex + 1 })}</Typography>
        </Box>
        <Typography data-testid="bookmark-card-created-at" component="time" dateTime={createdAt.toISOString()} variant="caption" noWrap sx={{ display: 'block', color: '#71717a', lineHeight: '1rem' }}>
          {createdAtLabel}
        </Typography>
        <Typography data-testid="bookmark-card-comment" variant="caption" noWrap sx={{ display: 'block', minHeight: '1rem', color: '#a1a1aa', lineHeight: '1rem' }}>
          {bookmark.comment ?? ''}
        </Typography>
      </Box>
    </Box>
  );
}
