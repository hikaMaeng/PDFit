import { useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Box, ButtonBase, IconButton, Popover, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, type IconButtonProps } from '@mui/material';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import ViewStreamIcon from '@mui/icons-material/ViewStream';
import CropPortraitIcon from '@mui/icons-material/CropPortrait';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import AutoStoriesIcon from '@mui/icons-material/AutoStories';
import FitScreenIcon from '@mui/icons-material/FitScreen';
import HeightIcon from '@mui/icons-material/Height';
import TuneIcon from '@mui/icons-material/Tune';
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined';
import CheckIcon from '@mui/icons-material/Check';
import StraightenIcon from '@mui/icons-material/Straighten';
import TocIcon from '@mui/icons-material/Toc';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import TextSnippetOutlinedIcon from '@mui/icons-material/TextSnippetOutlined';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import { DEFAULT_COLOR_ADJUSTMENTS, sameColorAdjustments, type PdfGpuColorAdjustments, type PdfGpuColorAdjustmentState } from '@pdfgpu/core';
import { usePdfitI18n } from '../../i18n/usePdfitI18n.js';
import { backgroundKeys, deskewKeys, toolbarLabels as labels } from './resource.js';
import { viewerBackgroundPalette, viewerBackgroundPreference } from '../../model/viewerBackgroundPreference.js';
import { ImageAdjustmentPopover } from './ImageAdjustmentPopover.js';
import { ScanControls } from './ScanControls.js';
import type { OcrScanBook } from '../../api/ocr.js';
import { COMMENT } from '../book-comments/resource.js';

type PageLayout = 'single' | 'double';
export type RenderViewerDocumentActions = (page?: number, pageCount?: number) => ReactNode;
type ViewerDeskewControl = { enabled: boolean; onToggle: () => void };

type Props = {
  pageLayout: PageLayout;
  coverAloneSelected?: boolean;
  continuousScroll: boolean;
  zoomInput: string;
  zoomOutDisabled?: boolean;
  zoomInDisabled?: boolean;
  colorAdjustments: PdfGpuColorAdjustmentState;
  showBackgroundControl?: boolean;
  deskew?: ViewerDeskewControl;
  documentActions?: ReactNode;
  scanBook?: OcrScanBook;
  outlineOpen: boolean;
  outlineDisabled: boolean;
  outlineId: string;
  pageInput: string;
  pageCount: number;
  previousDisabled: boolean;
  nextDisabled: boolean;
  onPageLayoutChange: (mode: PageLayout) => void;
  onToggleSpreadCover: () => void;
  onToggleContinuousScroll: () => void;
  onFitWidth: () => void;
  onFitHeight: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onZoomInputChange: (value: string) => void;
  onSubmitZoom: () => void;
  onColorAdjustmentsChange: (adjustments: PdfGpuColorAdjustments) => void;
  onOpenOutline: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onPageInputChange: (value: string) => void;
  onSubmitPage: (value: string) => void;
  onScanPageSelect: (page: number) => void;
};

const buttonStyle = { minWidth: 36, minHeight: 36, px: 0.75, py: 0.25, borderRadius: 1 };
const toggleStyle = { ...buttonStyle, border: 0 };
const groupStyle = { display: 'flex', alignItems: 'center', flexShrink: 0, gap: 0.25 };
const dividedGroupStyle = { ...groupStyle, borderInlineStart: '1px solid', borderColor: 'divider', paddingInlineStart: 0.5 };

function ButtonContent({ icon, caption }: { icon: ReactNode; caption: string }) {
  return <Box component="span" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', '& .MuiSvgIcon-root': { fontSize: 17 } }}>
    {icon}
    <Box component="span" lang="en" translate="no" aria-hidden="true" sx={{ fontSize: '0.625rem', lineHeight: 1, fontWeight: 500, textTransform: 'none', whiteSpace: 'nowrap' }}>{caption}</Box>
  </Box>;
}

export function ToolbarButton({ icon, caption, label, tooltip = label, ...props }: IconButtonProps & { icon: ReactNode; caption: string; label: string; tooltip?: string; 'data-testid'?: string }) {
  const button = <IconButton size="small" aria-label={label} sx={buttonStyle} {...props}><ButtonContent icon={icon} caption={caption} /></IconButton>;
  return <Tooltip title={tooltip} describeChild arrow>{props.disabled ? <span>{button}</span> : button}</Tooltip>;
}

export function ViewerToolbarFrame({ children }: { children: ReactNode }) {
  return <Box role="toolbar" aria-label={labels.controls} sx={{
    display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', columnGap: 0.75, rowGap: 0.25,
    px: { xs: 1, sm: 2 }, py: 0.25, flexShrink: 0,
    bgcolor: (theme) => theme.palette.mode === 'light' ? '#f5efe4' : 'background.paper',
    borderBottom: '1px solid', borderColor: 'divider', position: 'relative', zIndex: 10,
  }}>{children}</Box>;
}

// see apps/pdfit/docs/usage.md#viewer-toolbar
export function ViewerDocumentActions({ onOcr, ocrDisabled, onDownload, comments }: {
  onOcr?: () => void;
  ocrDisabled?: boolean;
  onDownload: () => void;
  comments?: { buttonId: string; panelId: string; open: boolean; onToggle: () => void };
}) {
  const { t } = usePdfitI18n();
  return <>
    {onOcr && <ToolbarButton icon={<TextSnippetOutlinedIcon />} caption={labels.ocr} label={t('ocrPage')} data-testid="page-ocr-open" aria-haspopup="dialog" onClick={onOcr} disabled={ocrDisabled} />}
    <ToolbarButton icon={<FileDownloadOutlinedIcon />} caption={labels.download} label={t('exportDocument')} data-testid="document-export-open" aria-haspopup="dialog" onClick={onDownload} />
    {comments && <ToolbarButton id={comments.buttonId} icon={<ChatBubbleOutlineIcon />} caption={labels.comments} label={t(COMMENT.BUTTON)}
      data-testid="viewer-comments-toggle" aria-haspopup="dialog" aria-expanded={comments.open}
      aria-controls={comments.open ? comments.panelId : undefined} color={comments.open ? 'primary' : 'default'} onClick={comments.onToggle} />}
  </>;
}

function ImageAdjustmentControl({ colors, onChange }: { colors: PdfGpuColorAdjustmentState; onChange: Props['onColorAdjustmentsChange'] }) {
  const { t } = usePdfitI18n();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const active = !sameColorAdjustments(colors, DEFAULT_COLOR_ADJUSTMENTS);
  return <>
    <ToolbarButton icon={<TuneIcon />} caption={labels.image} label={t('imageAdjustments')} color={active ? 'primary' : 'default'} aria-haspopup="dialog" aria-expanded={anchor !== null} onClick={(event) => setAnchor(event.currentTarget)} />
    <ImageAdjustmentPopover anchor={anchor} colors={colors} onChange={onChange} onClose={() => setAnchor(null)} />
  </>;
}

function ViewerBackgroundControl() {
  const { t } = usePdfitI18n();
  const { subscribe, getColor } = viewerBackgroundPreference;
  const selected = useSyncExternalStore(subscribe, getColor, getColor);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const label = t(backgroundKeys.button);
  const dialogId = useId();
  const titleId = useId();
  return <>
    <ToolbarButton icon={<PaletteOutlinedIcon />} caption={labels.background} label={label} aria-haspopup="dialog"
      aria-expanded={anchor !== null} aria-controls={anchor ? dialogId : undefined} onClick={(event) => setAnchor(event.currentTarget)} />
    <Popover open={anchor !== null} anchorEl={anchor} onClose={() => setAnchor(null)} marginThreshold={12}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      PaperProps={{ id: dialogId, role: 'dialog', 'aria-modal': true, 'aria-labelledby': titleId, sx: { mt: 0.5, p: 1.5 } }}>
      <Typography id={titleId} variant="subtitle2" sx={{ mb: 1 }}>{label}</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 0.5 }}>
        {viewerBackgroundPalette.map(([name, color]) => {
          const colorLabel = t(backgroundKeys.colors[name]);
          return <Tooltip key={name} title={colorLabel} arrow>
            <ButtonBase aria-label={colorLabel} aria-pressed={selected === color} onClick={() => {
              viewerBackgroundPreference.select(color);
              setAnchor(null);
            }} sx={{
              width: 40, height: 40, border: '1px solid', borderColor: 'divider', borderRadius: 1,
              backgroundColor: color, color: (theme) => theme.palette.getContrastText(color),
              '&.Mui-focusVisible, &:hover': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 },
            }}>
              {selected === color && <CheckIcon fontSize="small" />}
            </ButtonBase>
          </Tooltip>;
        })}
      </Box>
    </Popover>
  </>;
}

export function ViewerToolbar(props: Props) {
  const { t } = usePdfitI18n();
  return <ViewerToolbarFrame>
    <Box sx={groupStyle}>
      <ToggleButtonGroup size="small" value={props.pageLayout} exclusive onChange={(_, next: PageLayout | null) => { if (next) props.onPageLayoutChange(next); }}>
        <Tooltip title={t('singlePage')} describeChild arrow>
          <ToggleButton value="single" aria-label={t('singlePage')} sx={toggleStyle}><ButtonContent icon={<CropPortraitIcon />} caption={labels.single} /></ToggleButton>
        </Tooltip>
        <Tooltip title={t('doublePage')} describeChild arrow>
          <ToggleButton value="double" aria-label={t('doublePage')} sx={toggleStyle}><ButtonContent icon={<MenuBookIcon />} caption={labels.double} /></ToggleButton>
        </Tooltip>
      </ToggleButtonGroup>
      {props.coverAloneSelected !== undefined && <Tooltip title={t('coverAlone')} describeChild arrow>
        <ToggleButton value="cover-alone" selected={props.coverAloneSelected} aria-label={t('coverAlone')} data-testid="spread-cover-alone" onClick={props.onToggleSpreadCover} sx={toggleStyle}><ButtonContent icon={<AutoStoriesIcon />} caption={labels.cover} /></ToggleButton>
      </Tooltip>}
      <Tooltip title={t('continuousScroll')} describeChild arrow>
        <ToggleButton value="continuous" selected={props.continuousScroll} aria-label={t('continuousScroll')} onClick={props.onToggleContinuousScroll} sx={toggleStyle}><ButtonContent icon={<ViewStreamIcon />} caption={labels.scroll} /></ToggleButton>
      </Tooltip>
    </Box>
    <Box sx={dividedGroupStyle}>
      <ToolbarButton icon={<FitScreenIcon />} caption={labels.fitWidth} label={t('fitWidth')} onClick={props.onFitWidth} />
      <ToolbarButton icon={<HeightIcon />} caption={labels.fitHeight} label={t('fitHeight')} onClick={props.onFitHeight} />
    </Box>
    <Box sx={dividedGroupStyle}>
      <ToolbarButton icon={<ZoomOutIcon />} caption={labels.zoomOut} label={t('zoomOut')} onClick={props.onZoomOut} disabled={props.zoomOutDisabled} />
      <Box sx={groupStyle}>
        <TextField
          size="small"
          value={props.zoomInput}
          onChange={(event) => props.onZoomInputChange(event.target.value.replace(/[^0-9.]/g, ''))}
          onKeyDown={(event) => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.target.blur(); }}
          onBlur={props.onSubmitZoom}
          inputProps={{ inputMode: 'decimal', style: { textAlign: 'center', width: 34, padding: '2px', fontSize: '0.8rem' }, 'aria-label': t('zoomPercentage') }}
        />
        <Typography variant="caption" color="text.secondary">%</Typography>
      </Box>
      <ToolbarButton icon={<ZoomInIcon />} caption={labels.zoomIn} label={t('zoomIn')} onClick={props.onZoomIn} disabled={props.zoomInDisabled} />
    </Box>
    <Box sx={dividedGroupStyle}>
      <ImageAdjustmentControl colors={props.colorAdjustments} onChange={props.onColorAdjustmentsChange} />
      {props.showBackgroundControl && <ViewerBackgroundControl />}
      {props.deskew && <ToolbarButton icon={<StraightenIcon />} caption={labels.deskew} label={t(deskewKeys.toggle)}
        aria-pressed={props.deskew.enabled} disabled={props.pageCount === 0}
        color={props.deskew.enabled ? 'primary' : 'default'} onClick={props.deskew.onToggle}
        sx={{ ...buttonStyle, '&[aria-pressed="true"]': { bgcolor: 'action.selected' } }} />}
      {props.documentActions}
    </Box>
    <Box sx={{ ...groupStyle, flexShrink: 1, minWidth: 0, flexWrap: 'wrap', justifyContent: 'flex-end', marginInlineStart: 'auto' }}>
      {props.scanBook && props.pageCount > 0 && <ScanControls key={JSON.stringify([props.scanBook.folder, props.scanBook.filename])}
        {...props.scanBook} pageCount={props.pageCount} onNavigateToPage={props.onScanPageSelect} />}
      <ToolbarButton icon={<TocIcon />} caption={labels.contents} label={t('tableOfContents')}
        id={`${props.outlineId}-trigger`} data-testid="viewer-outline-open" aria-haspopup="dialog"
        aria-expanded={props.outlineOpen} aria-controls={props.outlineOpen ? props.outlineId : undefined}
        onClick={props.onOpenOutline} disabled={props.outlineDisabled} color={props.outlineOpen ? 'primary' : 'default'} />
      <ToolbarButton icon={<NavigateBeforeIcon />} caption={labels.previous} label={t('previousPage')} tooltip={`${t('previousPage')} (←/PageUp)`} onClick={props.onPrevious} disabled={props.previousDisabled} />
      <Box data-testid="viewer-page-indicator" sx={{ ...groupStyle, gap: 0.5 }}>
        <TextField
          size="small"
          value={props.pageInput}
          onChange={(event) => props.onPageInputChange(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) props.onSubmitPage(event.target.value); }}
          onBlur={(event) => props.onSubmitPage(event.target.value)}
          inputProps={{ style: { textAlign: 'center', width: 40, padding: '2px 4px', fontSize: '0.8rem' }, 'aria-label': t('pageNumber') }}
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: 1 } }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>/ {props.pageCount}</Typography>
      </Box>
      <ToolbarButton icon={<NavigateNextIcon />} caption={labels.next} label={t('nextPage')} tooltip={`${t('nextPage')} (→/PageDown)`} onClick={props.onNext} disabled={props.nextDisabled} />
    </Box>
  </ViewerToolbarFrame>;
}
