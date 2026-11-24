import CloseIcon from '@mui/icons-material/Close';
import { Box, IconButton, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { usePdfitI18n } from '../../i18n/usePdfitI18n.js';
import { RSC } from './resource.js';

export const BOOKMARK_PANEL_WIDTH = 'min(220px, 36vw)';

type Props = {
  id: string;
  armed: boolean;
  empty: boolean;
  onClose: () => void;
  left?: number;
  children: ReactNode;
};

export function BookmarkPanel({ id, armed, empty, onClose, left, children }: Props) {
  const { t } = usePdfitI18n();
  return (
    <Box id={id} component="aside" aria-label={t(RSC.clipPanel)} sx={{ position: left === undefined ? 'relative' : 'absolute', zIndex: 8, top: 0, bottom: 0, left: left === undefined ? undefined : `${left}px`, width: BOOKMARK_PANEL_WIDTH, boxSizing: 'border-box', flexShrink: 0, overflowY: 'auto', bgcolor: (theme) => theme.palette.mode === 'light' ? '#f5efe4' : '#242426', borderRight: '1px solid', borderColor: 'divider', p: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 0.5, pb: 0.75 }}>
        <Typography variant="caption" color="text.secondary">{t(RSC.clipPanel)}</Typography>
        <IconButton size="small" aria-label={t(RSC.close)} onClick={onClose}><CloseIcon fontSize="inherit" /></IconButton>
      </Box>
      {armed || empty ? <Typography component="p" variant="caption" color="text.secondary" sx={{ px: 0.5, mb: 0.75 }}>{t(armed ? RSC.dragToCapture : RSC.clipsEmpty)}</Typography> : null}
      {children}
    </Box>
  );
}
