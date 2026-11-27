import type { ComponentProps } from 'react';
import { Box } from '@mui/material';
import { usePdfitI18n } from '../../i18n/usePdfitI18n.js';
import { RSC } from './resource.js';

type Props = Pick<ComponentProps<'button'>, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' |
  'onPointerCancel' | 'onLostPointerCapture' | 'onKeyDown'>;

export function ViewerPopupResizeHandle(props: Props) {
  const { t } = usePdfitI18n();
  const label = t(RSC.VIEWER_POPUP_RESIZE_BUTTON);
  return <Box component="button" type="button" {...props} aria-label={label} title={label}
    aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
    sx={{
      position: 'absolute', right: 0, bottom: 0, width: 24, height: 24, zIndex: 1,
      p: 0, border: 0, bgcolor: 'background.paper', color: 'text.secondary', borderTopLeftRadius: 6,
      cursor: 'nwse-resize', touchAction: 'none', userSelect: 'none',
      '&:hover': { color: 'primary.main' },
      '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -3 },
      '&::after': {
        content: '""', position: 'absolute', right: 3, bottom: 3, width: 12, height: 12,
        clipPath: 'polygon(100% 0, 100% 100%, 0 100%)',
        background: 'repeating-linear-gradient(135deg, transparent 0 3px, currentColor 3px 4.5px)',
      },
    }} />;
}
