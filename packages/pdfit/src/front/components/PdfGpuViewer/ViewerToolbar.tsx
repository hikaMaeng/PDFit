import { useEffect, useState } from 'react';
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
import AttachFileIcon from '@mui/icons-material/AttachFile';
import type { PdfGpuViewerController, PdfGpuViewerState } from '@pdfgpu/core';
import { usePdfitI18n } from '../../i18n/usePdfitI18n.js';

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
  onFitHeight: () => void;
  onPageLayoutChange: (mode: 'single' | 'double') => void;
  onToggleContinuousScroll: () => void;
};

/** Page, zoom, view mode, bookmark, and annotation controls. */
export function ViewerToolbar(props: Props) {
  const { t } = usePdfitI18n();
  const { controller, state, currentPage, pageInput, inverted, bookmarkPanelOpen } = props;
  const pageLayout = state.viewMode === 'spread' ? 'double' : 'single';
  const continuousScroll = state.scrollMode === 'continuous';
  const pageStep = pageLayout === 'double' ? 2 : 1;
  const [zoomInput, setZoomInput] = useState(String(Math.round(state.zoom * 100)));

  useEffect(() => setZoomInput(String(Math.round(state.zoom * 100))), [state.zoom]);

  const submitZoom = () => {
    const percentage = Number.parseFloat(zoomInput.replace('%', '').trim());
    if (!Number.isFinite(percentage)) {
      setZoomInput(String(Math.round(state.zoom * 100)));
      return;
    }
    controller?.setZoom(Math.min(800, Math.max(25, percentage)) / 100);
  };

  return <Box role="toolbar" aria-label="viewer controls" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 2, py: 0.5, bgcolor: (theme) => theme.palette.mode === 'light' ? '#f5efe4' : 'background.paper', borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0, position: 'relative', zIndex: 10, overflowX: 'auto' }}>
    <ToggleButtonGroup size="small" value={pageLayout} exclusive onChange={(_, next: 'single' | 'double' | null) => { if (next) props.onPageLayoutChange(next); }} sx={{ '& .MuiToggleButton-root': { py: 0.25, px: 0.75, border: 'none' } }}>
      <ToggleButton value="single" aria-label={t('singlePage')}><Tooltip title={t('singlePage')} arrow><CropPortraitIcon fontSize="small" /></Tooltip></ToggleButton>
      <ToggleButton value="double" aria-label={t('doublePage')}><Tooltip title={t('doublePage')} arrow><MenuBookIcon fontSize="small" /></Tooltip></ToggleButton>
    </ToggleButtonGroup>
    <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
    <Tooltip title={t('continuousScroll')} arrow>
      <ToggleButton value="continuous" selected={continuousScroll} onClick={props.onToggleContinuousScroll} aria-label={t('continuousScroll')} aria-pressed={continuousScroll} sx={{ py: 0.25, px: 0.75, border: 'none' }}><ViewStreamIcon fontSize="small" /></ToggleButton>
    </Tooltip>
    <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
    <Tooltip title={t('fitWidth')} arrow><IconButton size="small" aria-label={t('fitWidth')} onClick={() => controller?.fitWidth()}><FitScreenIcon fontSize="small" /></IconButton></Tooltip>
    <Tooltip title={t('fitHeight')} arrow><IconButton size="small" aria-label={t('fitHeight')} onClick={props.onFitHeight}><HeightIcon fontSize="small" /></IconButton></Tooltip>
    <Tooltip title={t('zoomOut')} arrow><span><IconButton size="small" onClick={() => controller?.zoomOut()}><ZoomOutIcon fontSize="small" /></IconButton></span></Tooltip>
    <Box sx={{ display: 'flex', alignItems: 'center' }}>
      <TextField
        size="small"
        value={zoomInput}
        onChange={(event) => setZoomInput(event.target.value.replace(/[^0-9.]/g, ''))}
        onKeyDown={(event) => { if (event.key === 'Enter') (event.currentTarget.querySelector('input') as HTMLInputElement | null)?.blur(); }}
        onBlur={submitZoom}
        inputProps={{ inputMode: 'decimal', style: { textAlign: 'center', width: 38, padding: '2px 2px', fontSize: '0.8rem' }, 'aria-label': t('zoomPercentage') }}
      />
      <Typography variant="caption" color="text.secondary" sx={{ ml: 0.25 }}>%</Typography>
    </Box>
    <Tooltip title={t('zoomIn')} arrow><span><IconButton aria-label={t('zoomIn')} size="small" onClick={() => controller?.zoomIn()}><ZoomInIcon fontSize="small" /></IconButton></span></Tooltip>
    <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
    <Tooltip title={t('invertColors')} arrow><IconButton size="small" onClick={props.onToggleInverted} color={inverted ? 'primary' : 'default'}><InvertColorsIcon fontSize="small" /></IconButton></Tooltip>
    <Tooltip title={bookmarkPanelOpen ? t('closeBookmarkSidebar') : t('openBookmarkSidebar')} arrow><IconButton data-testid="bookmark-sidebar-toggle" aria-label={bookmarkPanelOpen ? t('closeBookmarkSidebar') : t('openBookmarkSidebar')} size="small" onClick={props.onToggleBookmarks} color={bookmarkPanelOpen ? 'primary' : 'default'}><AttachFileIcon fontSize="small" /></IconButton></Tooltip>
    <Box sx={{ flex: 1 }} />
    <Tooltip title={t('previousPage')} arrow><span><IconButton size="small" aria-label={t('previousPage')} title={t('previousPage')} onClick={() => props.onGoToPage(currentPage - pageStep)} disabled={currentPage <= 1}><NavigateBeforeIcon fontSize="small" /></IconButton></span></Tooltip>
    <Box data-testid="viewer-page-indicator" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <TextField size="small" value={pageInput} onChange={(event) => props.onPageInputChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') props.onSubmitPage((event.target as HTMLInputElement).value); }} onBlur={(event) => props.onSubmitPage((event.target as HTMLInputElement).value)} inputProps={{ style: { textAlign: 'center', width: 40, padding: '2px 4px', fontSize: '0.8rem' }, 'aria-label': t('pageNumber') }} />
      <Typography variant="caption" color="text.secondary">/ {state.pageCount}</Typography>
    </Box>
    <Tooltip title={t('nextPage')} arrow><span><IconButton size="small" aria-label={t('nextPage')} title={t('nextPage')} onClick={() => props.onGoToPage(currentPage + pageStep)} disabled={!state.pageCount || currentPage >= state.pageCount}><NavigateNextIcon fontSize="small" /></IconButton></span></Tooltip>
  </Box>;
}
