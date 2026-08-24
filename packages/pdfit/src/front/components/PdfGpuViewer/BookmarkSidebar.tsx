import { Box, CircularProgress, IconButton, Tooltip, Typography } from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import type { BookmarkRecord } from '../../../common/protocol/bookmarks/index.js';

type Props = {
  bookmarks: BookmarkRecord[];
  recentId: string | null;
  deletingId: string | null;
  onEdit: (bookmark: BookmarkRecord) => void;
  onDelete: (id: string) => void;
  onGoToPage: (page: number) => void;
};

/** Bookmark list shown beside the PDF viewport. */
export function BookmarkSidebar({ bookmarks, recentId, deletingId, onEdit, onDelete, onGoToPage }: Props) {
  return <Box component="aside" aria-label="Book bookmarks" sx={{ width: 220, flexShrink: 0, overflowY: 'auto', bgcolor: '#242426', borderRight: '1px solid rgba(255,255,255,.08)', p: 1 }}>
    <Typography variant="caption" sx={{ display: 'block', color: 'grey.400', px: 0.5, pb: 0.75 }}>Book bookmarks</Typography>
    {bookmarks.length === 0 ? <Typography variant="caption" color="grey.600" sx={{ px: 0.5 }}>Drag on a page to capture.</Typography> : bookmarks.map((bookmark) => <Box data-testid="bookmark-card" component="article" role="button" tabIndex={0} key={bookmark.id} onClick={() => onEdit(bookmark)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onEdit(bookmark); } }} sx={{ display: 'block', width: '100%', mb: 1, p: 0, textAlign: 'left', cursor: 'pointer', border: `2px solid ${bookmark.borderColor}`, borderRadius: 1, overflow: 'hidden', bgcolor: '#303034' }}>
      <Box sx={{ height: 92, bgcolor: bookmark.fillColor ?? '#161618', position: 'relative' }}>
        <Box component="img" src={bookmark.imageUrl} alt="" sx={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain', bgcolor: '#161618' }} />
        {bookmark.fillColor && <Box sx={{ position: 'absolute', inset: 0, bgcolor: bookmark.fillColor, opacity: bookmark.fillOpacity, pointerEvents: 'none' }} />}
        <IconButton data-testid="viewer-bookmark-card-delete" aria-label="북마크 삭제" title="북마크 삭제" size="small" color="error" disabled={deletingId === bookmark.id} onClick={(event) => { event.stopPropagation(); onDelete(bookmark.id); }} sx={{ position: 'absolute', top: 2, right: 2, p: 0.25, opacity: recentId === bookmark.id ? 1 : 0.4, transform: recentId === bookmark.id ? 'scale(1.08)' : 'scale(1)', transition: recentId === bookmark.id ? 'none' : 'opacity 2.4s ease, transform 2.4s ease', bgcolor: 'rgba(10,10,12,.72)', '&:hover': { opacity: 0.9, bgcolor: 'rgba(10,10,12,.92)' } }}>
          {deletingId === bookmark.id ? <CircularProgress size={16} /> : <DeleteOutlineIcon sx={{ fontSize: 18 }} />}
        </IconButton>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.75, py: 0.5 }}>
        {bookmark.fillColor && <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: bookmark.fillColor, flexShrink: 0 }} />}
        <Typography variant="caption" noWrap sx={{ flex: 1, color: 'grey.200' }}>p. {bookmark.pageIndex + 1}</Typography>
        <Tooltip title="북마크 페이지로 이동" arrow><IconButton data-testid="bookmark-card-go-to-page" aria-label="북마크 페이지로 이동" size="small" onClick={(event) => { event.stopPropagation(); onGoToPage(bookmark.pageIndex + 1); }} sx={{ p: 0.25, color: 'grey.300', '&:hover': { color: 'primary.main', bgcolor: 'rgba(255,255,255,.08)' } }}><ArrowForwardIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
      </Box>
      {bookmark.comment && <Typography variant="caption" noWrap sx={{ display: 'block', px: 0.75, pb: 0.5, color: 'grey.400' }}>{bookmark.comment}</Typography>}
    </Box>)}
  </Box>;
}
