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
import BookmarkAddOutlinedIcon from '@mui/icons-material/BookmarkAddOutlined';
import CloudDoneOutlinedIcon from '@mui/icons-material/CloudDoneOutlined';
import CropSquareIcon from '@mui/icons-material/CropSquare';
import DrawIcon from '@mui/icons-material/Draw';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HighlightAltOutlinedIcon from '@mui/icons-material/HighlightAltOutlined';
import HorizontalRuleIcon from '@mui/icons-material/HorizontalRule';
import MouseOutlinedIcon from '@mui/icons-material/MouseOutlined';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import RedoIcon from '@mui/icons-material/Redo';
import SyncIcon from '@mui/icons-material/Sync';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import TuneIcon from '@mui/icons-material/Tune';
import UndoIcon from '@mui/icons-material/Undo';
import type { AnnotationStyle, AnnotationTool } from '../../../common/protocol/annotations/index.js';
import type { AnnotationSaveState } from './usePdfAnnotations.js';
import { useDraggablePalette } from './useDraggablePalette.js';

const TOOLS: ReadonlyArray<{ value: AnnotationTool; label: string; icon: typeof MouseOutlinedIcon }> = [
  { value: 'bookmark', label: '영역 북마크', icon: BookmarkAddOutlinedIcon },
  { value: 'select', label: '주석 선택·이동', icon: MouseOutlinedIcon },
  { value: 'highlight', label: '형광펜', icon: HighlightAltOutlinedIcon },
  { value: 'text', label: '텍스트 추가', icon: TextFieldsIcon },
  { value: 'pen', label: '자유 그리기', icon: DrawIcon },
  { value: 'rectangle', label: '사각형', icon: CropSquareIcon },
  { value: 'circle', label: '원', icon: RadioButtonUncheckedIcon },
  { value: 'line', label: '선', icon: HorizontalRuleIcon },
  { value: 'arrow', label: '화살표', icon: ArrowForwardIcon },
];

type Props = {
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
  const { tool, style, saveState, canUndo, canRedo, canRetry, onToolChange, onStyleChange, onUndo, onRedo, onRetry } = props;
  const [styleAnchor, setStyleAnchor] = useState<HTMLElement | null>(null);
  const { paletteRef, position, dragHandleProps } = useDraggablePalette('pdfit.annotationPalette.position');
  const saveLabel = saveState === 'loading' ? '주석 불러오는 중' : saveState === 'saving' ? '주석 저장 중' : saveState === 'saved' ? '주석 저장됨' : '주석 저장 실패';
  const SaveIcon = saveState === 'error' ? ErrorOutlineIcon : saveState === 'saved' ? CloudDoneOutlinedIcon : SyncIcon;

  const openStyle = (event: MouseEvent<HTMLElement>) => setStyleAnchor(event.currentTarget);

  return (
    <Box
      ref={paletteRef}
      component="aside"
      aria-label="PDF 주석 도구"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      sx={{
        position: 'absolute',
        left: position.x,
        top: position.y,
        width: 40,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0.25,
        pb: 0.5,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        boxShadow: 4,
        overflow: 'hidden',
        zIndex: 10,
      }}
    >
      <Tooltip title="도구 팔레트 이동" placement="right" arrow>
        <Box
          role="button"
          tabIndex={0}
          aria-label="annotation palette drag handle"
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
        aria-label="annotation tools"
        sx={{ gap: 0.125 }}
      >
        {TOOLS.map(({ value, label, icon: ToolIcon }, index) => (
          <Box key={value} sx={{ display: 'contents' }}>
            {index === 2 ? <Divider sx={{ my: 0.125 }} /> : null}
            <Tooltip title={label} placement="right" arrow>
              <ToggleButton value={value} aria-label={value} sx={railButtonSx}>
                <ToolIcon fontSize="small" />
              </ToggleButton>
            </Tooltip>
          </Box>
        ))}
      </ToggleButtonGroup>

      <Divider flexItem sx={{ mx: 0.5, my: 0.125 }} />
      <Tooltip title="실행 취소" placement="right" arrow>
        <span><IconButton size="small" aria-label="annotation undo" disabled={!canUndo} onClick={onUndo} sx={railButtonSx}><UndoIcon fontSize="small" /></IconButton></span>
      </Tooltip>
      <Tooltip title="다시 실행" placement="right" arrow>
        <span><IconButton size="small" aria-label="annotation redo" disabled={!canRedo} onClick={onRedo} sx={railButtonSx}><RedoIcon fontSize="small" /></IconButton></span>
      </Tooltip>
      <Tooltip title="주석 스타일" placement="right" arrow>
        <IconButton size="small" aria-label="annotation style" onClick={openStyle} sx={railButtonSx}>
          <TuneIcon fontSize="small" />
          <Box sx={{ position: 'absolute', right: 4, bottom: 4, width: 8, height: 8, borderRadius: '50%', bgcolor: style.color, border: '1px solid', borderColor: 'background.paper' }} />
        </IconButton>
      </Tooltip>
      <Tooltip title={saveLabel} placement="right" arrow>
        <Box role="status" aria-label="annotation save status" sx={{ display: 'grid', placeItems: 'center', width: 32, height: 28, color: saveState === 'error' ? 'error.main' : saveState === 'saved' ? 'success.main' : 'text.disabled' }}>
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
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>주석 스타일</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: '72px 1fr', alignItems: 'center', gap: 1.25 }}>
          <Typography variant="caption">선 색상</Typography>
          <Box component="label" aria-label="annotation color" title="선 색상" sx={{ display: 'inline-flex', alignItems: 'center' }}>
            <Box component="input" type="color" value={style.color} onInput={(event) => onStyleChange({ color: (event.target as HTMLInputElement).value })} sx={{ width: 40, height: 28, p: 0, border: 0, bgcolor: 'transparent', cursor: 'pointer' }} />
          </Box>
          <Typography variant="caption">선 두께</Typography>
          <Slider aria-label="annotation stroke width" min={1} max={12} step={1} value={style.strokeWidth} valueLabelDisplay="auto" onChange={(_, value) => onStyleChange({ strokeWidth: value as number })} />
          <Typography variant="caption">투명도</Typography>
          <Slider aria-label="annotation opacity" min={0.1} max={1} step={0.1} value={style.opacity} valueLabelDisplay="auto" onChange={(_, value) => onStyleChange({ opacity: value as number })} />
        </Box>
        <FormControlLabel control={<Switch size="small" checked={style.fillColor !== null} onChange={(_, checked) => onStyleChange({ fillColor: checked ? style.color : null })} />} label="도형 채우기" sx={{ mt: 1, ml: 0 }} />
        {style.fillColor !== null ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 0.5 }}>
            <Typography variant="caption">채움 색상</Typography>
            <Box component="label" aria-label="annotation fill color" title="채움 색상" sx={{ display: 'inline-flex' }}>
              <Box component="input" type="color" value={style.fillColor} onInput={(event) => onStyleChange({ fillColor: (event.target as HTMLInputElement).value })} sx={{ width: 40, height: 28, p: 0, border: 0, bgcolor: 'transparent', cursor: 'pointer' }} />
            </Box>
          </Box>
        ) : null}
        {canRetry ? <Button fullWidth size="small" color="error" sx={{ mt: 1.5 }} onClick={onRetry}>저장 다시 시도</Button> : null}
      </Popover>
    </Box>
  );
}
