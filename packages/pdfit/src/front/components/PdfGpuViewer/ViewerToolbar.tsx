import { Box, Divider, IconButton, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import ViewStreamIcon from '@mui/icons-material/ViewStream';
import CropPortraitIcon from '@mui/icons-material/CropPortrait';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import FitScreenIcon from '@mui/icons-material/FitScreen';
import HeightIcon from '@mui/icons-material/Height';
import InvertColorsIcon from '@mui/icons-material/InvertColors';
import BookmarksIcon from '@mui/icons-material/Bookmarks';
import type { PdfGpuViewerController, PdfGpuViewerState } from '@pdfgpu/core';

type Props = {
  controller: PdfGpuViewerController | null;
  state: PdfGpuViewerState;
  currentPage: number;
  pageInput: string;
  inverted: boolean;
  bookmarkPanelOpen: boolean;
  onPageInputChange: (value: string) => void;
  onSubmitPage: (value: string) => void;
  onGoToPage: (page: number) => void;
  onToggleInverted?: () => void;
  onToggleBookmarks: () => void;
  onViewModeChange: (mode: 'scroll' | 'single' | 'double') => void;
};

/** Page, zoom, view mode, bookmark, and annotation controls. */
export function ViewerToolbar(props: Props) {
  const { controller, state, currentPage, pageInput, inverted, bookmarkPanelOpen } = props;
  const viewMode = state.scrollMode === 'continuous' ? 'scroll' : state.viewMode === 'spread' ? 'double' : 'single';
  return <Box role="toolbar" aria-label="viewer controls" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 2, py: 0.5, bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0, overflowX: 'auto' }}>
    <Tooltip title="이전 페이지" arrow><span><IconButton size="small" aria-label="이전 페이지" title="이전 페이지" onClick={() => props.onGoToPage(currentPage - 1)} disabled={currentPage <= 1}><NavigateBeforeIcon fontSize="small" /></IconButton></span></Tooltip>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <TextField size="small" value={pageInput} onChange={(event) => props.onPageInputChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') props.onSubmitPage((event.target as HTMLInputElement).value); }} onBlur={(event) => props.onSubmitPage((event.target as HTMLInputElement).value)} inputProps={{ style: { textAlign: 'center', width: 40, padding: '2px 4px', fontSize: '0.8rem' }, 'aria-label': 'page number' }} />
      <Typography variant="caption" color="text.secondary">/ {state.pageCount}</Typography>
    </Box>
    <Tooltip title="다음 페이지" arrow><span><IconButton size="small" aria-label="다음 페이지" title="다음 페이지" onClick={() => props.onGoToPage(currentPage + 1)} disabled={!state.pageCount || currentPage >= state.pageCount}><NavigateNextIcon fontSize="small" /></IconButton></span></Tooltip>
    <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
    <Tooltip title="축소" arrow><span><IconButton size="small" onClick={() => controller?.zoomOut()}><ZoomOutIcon fontSize="small" /></IconButton></span></Tooltip>
    <Typography variant="caption" sx={{ minWidth: 40, textAlign: 'center', color: 'text.secondary' }}>{Math.round(state.zoom * 100)}%</Typography>
    <Tooltip title="확대" arrow><span><IconButton aria-label="확대" size="small" onClick={() => controller?.zoomIn()}><ZoomInIcon fontSize="small" /></IconButton></span></Tooltip>
    <Tooltip title="가로 너비 맞춤" arrow><IconButton size="small" onClick={() => controller?.fitWidth()} color={state.fitMode === 'width' ? 'primary' : 'default'}><FitScreenIcon fontSize="small" /></IconButton></Tooltip>
    <Tooltip title="세로 높이 맞춤" arrow><IconButton size="small" onClick={() => controller?.fitHeight()} color={state.fitMode === 'height' ? 'primary' : 'default'}><HeightIcon fontSize="small" /></IconButton></Tooltip>
    <Tooltip title="색상 반전" arrow><IconButton size="small" onClick={props.onToggleInverted} color={inverted ? 'primary' : 'default'}><InvertColorsIcon fontSize="small" /></IconButton></Tooltip>
    <Tooltip title={bookmarkPanelOpen ? '북마크 사이드바 닫기' : '북마크 사이드바 열기'} arrow><IconButton data-testid="bookmark-sidebar-toggle" aria-label={bookmarkPanelOpen ? '북마크 사이드바 닫기' : '북마크 사이드바 열기'} size="small" onClick={props.onToggleBookmarks} color={bookmarkPanelOpen ? 'primary' : 'default'}><BookmarksIcon fontSize="small" /></IconButton></Tooltip>
    <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
    <ToggleButtonGroup size="small" value={viewMode} exclusive onChange={(_, next) => { if (next) props.onViewModeChange(next); }} sx={{ '& .MuiToggleButton-root': { py: 0.25, px: 0.75, border: 'none' } }}>
      <ToggleButton value="scroll"><Tooltip title="연속 스크롤" arrow><ViewStreamIcon fontSize="small" /></Tooltip></ToggleButton>
      <ToggleButton value="single"><Tooltip title="한 페이지 보기" arrow><CropPortraitIcon fontSize="small" /></Tooltip></ToggleButton>
      <ToggleButton value="double"><Tooltip title="두 페이지 보기" arrow><MenuBookIcon fontSize="small" /></Tooltip></ToggleButton>
    </ToggleButtonGroup>
    <Box sx={{ flex: 1 }} />
  </Box>;
}
