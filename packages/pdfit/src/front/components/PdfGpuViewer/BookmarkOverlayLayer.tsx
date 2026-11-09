import { Box, CircularProgress, IconButton, Tooltip } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import type { BookmarkRecord } from '../../../common/protocol/bookmarks/index.js';

type Overlay = { pageIndex: number; left: number; top: number; width: number; height: number; borderColor: string; fillColor?: string; fillOpacity?: number; comment?: string };
type Point = { x: number; y: number };
type Props = { overlays: Overlay[]; bookmarks: BookmarkRecord[]; recentId: string | null; deletingId: string | null; captureDrag: { start: Point; end: Point } | null; onDelete: (id: string) => void };

/** Projects bookmark rectangles and capture feedback over rendered pages. */
export function BookmarkOverlayLayer({ overlays, bookmarks, recentId, deletingId, captureDrag, onDelete }: Props) {
  return <Box data-testid="bookmark-overlay-layer" sx={{ position: 'absolute', inset: 0, zIndex: 3, pointerEvents: 'none' }}>
    {overlays.map((overlay, index) => {
      const bookmark = bookmarks[index];
      return <Tooltip key={`${overlay.pageIndex}-${index}`} title={overlay.comment ?? ''} disableHoverListener={!overlay.comment}>
        <Box data-testid="bookmark-page-overlay" sx={{ position: 'absolute', left: overlay.left, top: overlay.top, width: overlay.width, height: overlay.height, boxSizing: 'border-box', border: `2px solid ${overlay.borderColor}`, pointerEvents: bookmark || overlay.comment ? 'auto' : 'none', zIndex: 2 }}>
          {overlay.fillColor && <Box sx={{ position: 'absolute', inset: 0, bgcolor: overlay.fillColor, opacity: overlay.fillOpacity ?? 0.2, pointerEvents: 'none' }} />}
          {bookmark && <IconButton data-testid="bookmark-overlay-delete" aria-label="북마크 삭제" title="북마크 삭제" size="small" color="error" disabled={deletingId === bookmark.id} onClick={(event) => { event.stopPropagation(); onDelete(bookmark.id); }} sx={{ position: 'absolute', top: 2, right: 2, p: 0.2, opacity: recentId === bookmark.id ? 1 : 0.4, transform: recentId === bookmark.id ? 'scale(1.12)' : 'scale(1)', transformOrigin: 'top right', transition: recentId === bookmark.id ? 'none' : 'opacity 2.4s ease, transform 2.4s ease', bgcolor: 'rgba(10,10,12,.55)', zIndex: 3, '&:hover': { opacity: 0.9, bgcolor: 'rgba(10,10,12,.82)' } }}>
            {deletingId === bookmark.id ? <CircularProgress size={16} /> : <DeleteOutlineIcon sx={{ fontSize: 18 }} />}
          </IconButton>}
        </Box>
      </Tooltip>;
    })}
    {captureDrag && <Box data-testid="bookmark-drag-preview" sx={{ position: 'absolute', left: Math.min(captureDrag.start.x, captureDrag.end.x), top: Math.min(captureDrag.start.y, captureDrag.end.y), width: Math.abs(captureDrag.end.x - captureDrag.start.x), height: Math.abs(captureDrag.end.y - captureDrag.start.y), boxSizing: 'border-box', border: '2px dashed #f59e0b', bgcolor: 'rgba(245, 158, 11, 0.18)' }} />}
  </Box>;
}
