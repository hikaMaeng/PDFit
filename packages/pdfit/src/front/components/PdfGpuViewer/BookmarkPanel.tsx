import CloseIcon from '@mui/icons-material/Close';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import { Box, ButtonBase, IconButton, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { usePdfitI18n } from '../../i18n/usePdfitI18n.js';
import { RSC } from './resource.js';
import { useDraggablePalette } from './useDraggablePalette.js';

type Props = {
  id: string;
  armed: boolean;
  empty: boolean;
  onClose: () => void;
  children: ReactNode;
};

export function BookmarkPanel({ id, armed, empty, onClose, children }: Props) {
  const { t } = usePdfitI18n();
  const { paletteRef, position, dragHandleProps } = useDraggablePalette('pdfit.viewerClipList.position', { x: 80, y: 12 });
  return (
    <Box
      id={id}
      ref={paletteRef}
      component="aside"
      aria-label={t(RSC.clipPanel)}
      sx={{
        position: 'absolute', zIndex: 9, top: position.y, left: position.x,
        width: 220, maxWidth: 'calc(100% - 16px)', maxHeight: 'min(480px, 100% - 16px)',
        boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
        bgcolor: (theme) => theme.palette.mode === 'light' ? '#f5efe4' : '#242426',
        border: '1px solid', borderColor: 'divider', borderRadius: 1, boxShadow: 4,
      }}
    >
      <Box sx={{ display: 'flex', flexShrink: 0, alignItems: 'center', gap: 0.5, p: 0.5 }}>
        <ButtonBase
          aria-label={t(RSC.moveClipPanel)}
          {...dragHandleProps}
          sx={{ flex: 1, minWidth: 0, minHeight: 32, justifyContent: 'flex-start', gap: 0.5, px: 0.5, borderRadius: 1, color: 'text.secondary', cursor: 'grab', touchAction: 'none', '&:active': { cursor: 'grabbing' }, '&.Mui-focusVisible': { bgcolor: 'action.focus' } }}
        >
          <DragIndicatorIcon fontSize="small" />
          <Typography variant="caption" noWrap>{t(RSC.clipPanel)}</Typography>
        </ButtonBase>
        <IconButton size="small" aria-label={t(RSC.close)} onClick={onClose} sx={{ minWidth: 32, minHeight: 32 }}><CloseIcon fontSize="inherit" /></IconButton>
      </Box>
      <Box sx={{ minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', px: 1 }}>
        {armed || empty ? <Typography component="p" variant="caption" color="text.secondary" sx={{ px: 0.5, mb: 0.75 }}>{t(armed ? RSC.dragToCapture : RSC.clipsEmpty)}</Typography> : null}
        {children}
      </Box>
    </Box>
  );
}
