import { useRef } from 'react';
import CloseIcon from '@mui/icons-material/Close';
import { IconButton } from '@mui/material';
import { usePdfitI18n } from '../../i18n/usePdfitI18n.js';

export function ViewerPopupCloseButton({ onClose, disabled, size = 'small' }: {
  onClose: () => void;
  disabled?: boolean;
  size?: 'small' | 'medium';
}) {
  const { t } = usePdfitI18n();
  const touch = useRef<{ id: number; x: number; y: number } | null>(null);
  return <IconButton type="button" size={size} aria-label={t('close')} title={t('close')} disabled={disabled}
    onClick={onClose} sx={{ touchAction: 'manipulation', flexShrink: 0 }}
    onPointerDown={(event) => {
      if (event.pointerType === 'touch' && event.isPrimary) {
        touch.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      }
    }}
    onPointerCancel={() => { touch.current = null; }}
    onPointerUp={(event) => {
      const start = touch.current;
      if (start?.id !== event.pointerId) return;
      touch.current = null;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) return;
      const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect();
      if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) return;
      // Chromium may omit the compatibility click on the first tap after a resize gesture.
      event.preventDefault();
      onClose();
    }}>
    <CloseIcon fontSize={size === 'small' ? 'small' : 'medium'} />
  </IconButton>;
}
