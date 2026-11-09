import { useState, type MouseEvent } from 'react';
import {
  Box,
  Button,
  Divider,
  FormControlLabel,
  IconButton,
  Popover,
  Slider,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import CloudDoneOutlinedIcon from '@mui/icons-material/CloudDoneOutlined';
import CropSquareIcon from '@mui/icons-material/CropSquare';
import DrawIcon from '@mui/icons-material/Draw';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HighlightAltOutlinedIcon from '@mui/icons-material/HighlightAltOutlined';
import HorizontalRuleIcon from '@mui/icons-material/HorizontalRule';
import NearMeOutlinedIcon from '@mui/icons-material/NearMeOutlined';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import RedoIcon from '@mui/icons-material/Redo';
import SyncIcon from '@mui/icons-material/Sync';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import TuneIcon from '@mui/icons-material/Tune';
import UndoIcon from '@mui/icons-material/Undo';
import type { AnnotationStyle, AnnotationTool } from '../../../common/protocol/annotations/index.js';
import type { AnnotationSaveState } from './usePdfAnnotations.js';
import { useDraggablePalette } from './useDraggablePalette.js';
import { usePdfitI18n } from '../../i18n/usePdfitI18n.js';
import type { PdfitMessageKey } from '../../i18n/messages.js';

const TOOLS: ReadonlyArray<{ value: AnnotationTool; label: PdfitMessageKey; icon: typeof NearMeOutlinedIcon }> = [
  { value: 'bookmark', label: 'areaBookmark', icon: Inventory2OutlinedIcon },
  { value: 'select', label: 'selectAnnotation', icon: NearMeOutlinedIcon },
  { value: 'highlight', label: 'highlighter', icon: HighlightAltOutlinedIcon },
  { value: 'text', label: 'addText', icon: TextFieldsIcon },
  { value: 'pen', label: 'freehand', icon: DrawIcon },
  { value: 'rectangle', label: 'rectangle', icon: CropSquareIcon },
  { value: 'circle', label: 'circle', icon: RadioButtonUncheckedIcon },
  { value: 'line', label: 'line', icon: HorizontalRuleIcon },
  { value: 'arrow', label: 'arrow', icon: ArrowForwardIcon },
];

type Props = {
  leftOffset?: number;
  tool: AnnotationTool;
  style: AnnotationStyle;
  saveState: AnnotationSaveState;
  canUndo: boolean;
  canRedo: boolean;
  canRetry: boolean;
  onToolChange: (tool: AnnotationTool) => void;
  onStyleChange: (style: Partial<AnnotationStyle>) => void;
  onUndo: () => void;
  onRedo: () => void;
  onRetry: () => void;
};

/** Horizontal space reserved for the default annotation palette. */
export const ANNOTATION_RAIL_WIDTH = 64;

const railButtonSx = {
  width: 32,
  height: 32,
  p: 0,
  border: 0,
  borderRadius: '4px !important',
  color: 'text.secondary',
  '&.Mui-selected': {
    bgcolor: 'primary.main',
    color: 'primary.contrastText',
    '&:hover': { bgcolor: 'primary.dark' },
  },
};

/** Compact PDF-editor rail for annotation tools and styles. */
export function AnnotationControls(props: Props) {
  const { t, ui } = usePdfitI18n();
  const { leftOffset = 0, tool, style, saveState, canUndo, canRedo, canRetry, onToolChange, onStyleChange, onUndo, onRedo, onRetry } = props;
  const [styleAnchor, setStyleAnchor] = useState<HTMLElement | null>(null);
  const { paletteRef, position, dragHandleProps } = useDraggablePalette('pdfit.annotationPalette.position');
  const saveLabel = saveState === 'loading' ? ui("주석 불러오는 중") : saveState === 'saving' ? ui("주석 저장 중") : saveState === 'saved' ? ui("주석 저장됨") : ui("주석 저장 실패");
  const SaveIcon = saveState === 'error' ? ErrorOutlineIcon : saveState === 'saved' ? CloudDoneOutlinedIcon : SyncIcon;

  const openStyle = (event: MouseEvent<HTMLElement>) => setStyleAnchor(event.currentTarget);

  return (
    <Box
      ref={paletteRef}
      component="aside"
      aria-label={t('annotationTools')}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      sx={{
        position: 'absolute',
        left: position.x + leftOffset,
        top: position.y,
        width: 40,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0.25,
        pb: 0.5,
        bgcolor: (theme) => theme.palette.mode === 'light' ? '#f5efe4' : 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        boxShadow: 4,
        overflow: 'hidden',
        zIndex: 10,
      }}
    >
      <Tooltip title={t('movePalette')} placement="right" arrow>
        <Box
          role="button"
          tabIndex={0}
          aria-label={t('movePalette')}
          {...dragHandleProps}
          sx={{ width: '100%', height: 22, flex: '0 0 22px', display: 'grid', placeItems: 'center', color: 'text.disabled', cursor: 'grab', touchAction: 'none', borderBottom: '1px solid', borderColor: 'divider', '&:active': { cursor: 'grabbing' }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 } }}
        >
          <DragIndicatorIcon sx={{ fontSize: 20, transform: 'rotate(90deg)' }} />
        </Box>
      </Tooltip>
      <ToggleButtonGroup
        orientation="vertical"
        size="small"
        exclusive
        value={tool}
        onChange={(_, value: AnnotationTool | null) => { if (value) onToolChange(value); }}
        aria-label={t('annotationTools')}
        sx={{ gap: 0.125 }}
      >
        {TOOLS.map(({ value, label, icon: ToolIcon }, index) => (
          <Box key={value} sx={{ display: 'contents' }}>
            {index === 2 ? <Divider sx={{ my: 0.125 }} /> : null}
            <Tooltip title={t(label)} placement="right" arrow>
              <ToggleButton value={value} aria-label={t(label)} sx={railButtonSx}>
                <ToolIcon fontSize="small" data-testid={value === 'select' ? 'select-move-cursor-icon' : undefined} />
              </ToggleButton>
            </Tooltip>
          </Box>
        ))}
      </ToggleButtonGroup>

      <Divider flexItem sx={{ mx: 0.5, my: 0.125 }} />
      <Tooltip title={t('undo')} placement="right" arrow>
        <span><IconButton size="small" aria-label={t('undo')} disabled={!canUndo} onClick={onUndo} sx={railButtonSx}><UndoIcon fontSize="small" /></IconButton></span>
      </Tooltip>
      <Tooltip title={t('redo')} placement="right" arrow>
        <span><IconButton size="small" aria-label={t('redo')} disabled={!canRedo} onClick={onRedo} sx={railButtonSx}><RedoIcon fontSize="small" /></IconButton></span>
      </Tooltip>
      <Tooltip title={t('annotationStyle')} placement="right" arrow>
        <IconButton size="small" aria-label={t('annotationStyle')} onClick={openStyle} sx={railButtonSx}>
          <TuneIcon fontSize="small" />
          <Box sx={{ position: 'absolute', right: 4, bottom: 4, width: 8, height: 8, borderRadius: '50%', bgcolor: style.color, border: '1px solid', borderColor: 'background.paper' }} />
        </IconButton>
      </Tooltip>
      <Tooltip title={saveLabel} placement="right" arrow>
        <Box role="status" aria-label={saveLabel} sx={{ display: 'grid', placeItems: 'center', width: 32, height: 28, color: saveState === 'error' ? 'error.main' : saveState === 'saved' ? 'success.main' : 'text.disabled' }}>
          <SaveIcon fontSize="small" sx={saveState === 'loading' || saveState === 'saving' ? { animation: 'pdfit-spin 1.1s linear infinite', '@keyframes pdfit-spin': { to: { transform: 'rotate(360deg)' } } } : undefined} />
          <Box component="span" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{saveLabel}</Box>
        </Box>
      </Tooltip>

      <Popover
        open={Boolean(styleAnchor)}
        anchorEl={styleAnchor}
        onClose={() => setStyleAnchor(null)}
        anchorOrigin={{ vertical: 'center', horizontal: 'right' }}
        transformOrigin={{ vertical: 'center', horizontal: 'left' }}
        slotProps={{ paper: { sx: { ml: 1, width: 248, p: 2 } } }}
      >
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>{t('annotationStyle')}</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: '72px 1fr', alignItems: 'center', gap: 1.25 }}>
          <Typography variant="caption">{ui("선 색상")}</Typography>
          <Box component="label" aria-label={t('strokeColor')} title={ui("선 색상")} sx={{ display: 'inline-flex', alignItems: 'center' }}>
            <Box component="input" type="color" value={style.color} onInput={(event) => onStyleChange({ color: (event.target as HTMLInputElement).value })} sx={{ width: 40, height: 28, p: 0, border: 0, bgcolor: 'transparent', cursor: 'pointer' }} />
          </Box>
          <Typography variant="caption">{ui("선 두께")}</Typography>
          <Slider aria-label={t('strokeWidth')} min={1} max={12} step={1} value={style.strokeWidth} valueLabelDisplay="auto" onChange={(_, value) => onStyleChange({ strokeWidth: value as number })} />
          <Typography variant="caption">{ui("투명도")}</Typography>
          <Slider aria-label={t('opacity')} min={0.1} max={1} step={0.1} value={style.opacity} valueLabelDisplay="auto" onChange={(_, value) => onStyleChange({ opacity: value as number })} />
        </Box>
        <FormControlLabel control={<Switch size="small" checked={style.fillColor !== null} onChange={(_, checked) => onStyleChange({ fillColor: checked ? style.color : null })} />} label={ui("도형 채우기")} sx={{ mt: 1, ml: 0 }} />
        {style.fillColor !== null ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 0.5 }}>
            <Typography variant="caption">{ui("채움 색상")}</Typography>
            <Box component="label" aria-label={t('fillColor')} title={ui("채움 색상")} sx={{ display: 'inline-flex' }}>
              <Box component="input" type="color" value={style.fillColor} onInput={(event) => onStyleChange({ fillColor: (event.target as HTMLInputElement).value })} sx={{ width: 40, height: 28, p: 0, border: 0, bgcolor: 'transparent', cursor: 'pointer' }} />
            </Box>
          </Box>
        ) : null}
        {canRetry ? <Button fullWidth size="small" color="error" sx={{ mt: 1.5 }} onClick={onRetry}>{ui("저장 다시 시도")}</Button> : null}
      </Popover>
    </Box>
  );
}
