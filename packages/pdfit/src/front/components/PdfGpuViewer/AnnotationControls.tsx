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
  Typography,
} from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import BorderColorIcon from '@mui/icons-material/BorderColor';
import CloudDoneOutlinedIcon from '@mui/icons-material/CloudDoneOutlined';
import CropSquareIcon from '@mui/icons-material/CropSquare';
import DrawIcon from '@mui/icons-material/Draw';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HorizontalRuleIcon from '@mui/icons-material/HorizontalRule';
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
import { RSC } from './resource.js';

const TOOLS: ReadonlyArray<{ value: AnnotationTool; label: PdfitMessageKey; caption?: PdfitMessageKey; icon: typeof AttachFileIcon }> = [
  { value: 'bookmark', label: RSC.clips, icon: AttachFileIcon },
  { value: 'highlight', label: RSC.highlighter, icon: BorderColorIcon },
  { value: 'text', label: RSC.addText, caption: RSC.textCaption, icon: TextFieldsIcon },
  { value: 'pen', label: RSC.freehand, caption: RSC.penCaption, icon: DrawIcon },
  { value: 'rectangle', label: RSC.rectangle, icon: CropSquareIcon },
  { value: 'circle', label: RSC.circle, icon: RadioButtonUncheckedIcon },
  { value: 'line', label: RSC.line, icon: HorizontalRuleIcon },
  { value: 'arrow', label: RSC.arrow, icon: ArrowForwardIcon },
];

type Props = {
  tool: AnnotationTool;
  clipPanelOpen: boolean;
  clipPanelId: string;
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
export const ANNOTATION_RAIL_WIDTH = 80;

const iconCaptionSx = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '2px',
  '& .MuiSvgIcon-root': { fontSize: 17 },
} as const;

const railButtonSx = {
  ...iconCaptionSx,
  width: '100%',
  minHeight: 32,
  p: 0.25,
  border: 0,
  borderRadius: 1,
  flexShrink: 0,
  color: 'text.secondary',
  '&.Mui-selected': {
    bgcolor: 'primary.main',
    color: 'primary.contrastText',
    '&:hover': { bgcolor: 'primary.dark' },
  },
};

function RailCaption({ children }: { children: string }) {
  return <Box component="span" sx={{ maxWidth: '100%', fontSize: '0.625rem', lineHeight: 1.1, fontWeight: 500, textAlign: 'center', textTransform: 'none', overflowWrap: 'anywhere' }}>{children}</Box>;
}

/** Compact PDF-editor rail for annotation tools and styles. */
export function AnnotationControls(props: Props) {
  const { t, ui } = usePdfitI18n();
  const { tool, clipPanelOpen, clipPanelId, style, saveState, canUndo, canRedo, canRetry, onToolChange, onStyleChange, onUndo, onRedo, onRetry } = props;
  const [styleAnchor, setStyleAnchor] = useState<HTMLElement | null>(null);
  const { paletteRef, position, dragHandleProps } = useDraggablePalette('pdfit.annotationPalette.position');
  const saveLabel = saveState === 'loading' ? ui("주석 불러오는 중") : saveState === 'saving' ? ui("주석 저장 중") : saveState === 'saved' ? ui("주석 저장됨") : ui("주석 저장 실패");
  const SaveIcon = saveState === 'error' ? ErrorOutlineIcon : saveState === 'saved' ? CloudDoneOutlinedIcon : SyncIcon;

  const openStyle = (event: MouseEvent<HTMLElement>) => setStyleAnchor(event.currentTarget);

  return (
    <Box
      ref={paletteRef}
      component="aside"
      aria-label={t(RSC.tools)}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      sx={{
        position: 'absolute',
        left: position.x,
        top: position.y,
        width: 56,
        maxHeight: 'calc(100% - 24px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0.25,
        p: 0.25,
        bgcolor: (theme) => theme.palette.mode === 'light' ? '#f5efe4' : 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        boxShadow: 4,
        overflowX: 'hidden',
        overflowY: 'auto',
        scrollbarWidth: 'thin',
        zIndex: 10,
      }}
    >
      {TOOLS.map(({ value, label, caption = label, icon: ToolIcon }) => (
        <ToggleButton
          key={value}
          value={value}
          selected={tool === value}
          aria-label={t(label)}
          aria-expanded={value === 'bookmark' ? clipPanelOpen : undefined}
          aria-controls={value === 'bookmark' && clipPanelOpen ? clipPanelId : undefined}
          onClick={() => onToolChange(value)}
          sx={railButtonSx}
        >
          <ToolIcon />
          <RailCaption>{t(caption)}</RailCaption>
        </ToggleButton>
      ))}
      <Divider flexItem sx={{ mx: 0.5, my: 0.125 }} />
      <IconButton size="small" aria-label={t(RSC.undo)} disabled={!canUndo} onClick={onUndo} sx={railButtonSx}>
        <UndoIcon />
        <RailCaption>{t(RSC.undoCaption)}</RailCaption>
      </IconButton>
      <IconButton size="small" aria-label={t(RSC.redo)} disabled={!canRedo} onClick={onRedo} sx={railButtonSx}>
        <RedoIcon />
        <RailCaption>{t(RSC.redoCaption)}</RailCaption>
      </IconButton>
      <IconButton size="small" aria-label={t(RSC.style)} onClick={openStyle} sx={railButtonSx}>
        <Box sx={{ position: 'relative', display: 'flex' }}>
          <TuneIcon />
          <Box sx={{ position: 'absolute', right: -2, bottom: -1, width: 7, height: 7, borderRadius: '50%', bgcolor: style.color, border: '1px solid', borderColor: 'background.paper' }} />
        </Box>
        <RailCaption>{t(RSC.styleCaption)}</RailCaption>
      </IconButton>
      <Box role="status" aria-label={saveLabel} sx={{ ...iconCaptionSx, width: '100%', flexShrink: 0, py: 0.25, color: saveState === 'error' ? 'error.main' : saveState === 'saved' ? 'success.main' : 'text.disabled' }}>
        <SaveIcon sx={{ animation: saveState === 'loading' || saveState === 'saving' ? 'pdfit-spin 1.1s linear infinite' : undefined }} />
        <RailCaption>{t(RSC.saveCaptions[saveState])}</RailCaption>
      </Box>

      <IconButton
        size="small"
        aria-label={t(RSC.movePalette)}
        {...dragHandleProps}
        sx={{ ...railButtonSx, cursor: 'grab', touchAction: 'none', '&:active': { cursor: 'grabbing' } }}
      >
        <DragIndicatorIcon sx={{ transform: 'rotate(90deg)' }} />
        <RailCaption>{t(RSC.moveCaption)}</RailCaption>
      </IconButton>

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
