import { Box, LinearProgress, Typography } from '@mui/material';
import { usePdfitI18n } from '../i18n/usePdfitI18n.js';

interface PdfLoadingProgressProps {
  progress: number;
  determinate: boolean;
  label?: string;
}

/** Shared loading gauge used by every PDF rendering engine. */
export function PdfLoadingProgress({ progress, determinate, label }: PdfLoadingProgressProps) {
  const { t } = usePdfitI18n();
  const displayed = Math.min(100, Math.max(0, Math.round(progress)));
  return (
    <Box
      data-testid="viewer-load-progress-panel"
      sx={{ position: 'absolute', zIndex: 4, top: 8, left: '50%', transform: 'translateX(-50%)', width: 'min(420px, 70vw)', px: 1.5, py: 1, bgcolor: 'rgba(20, 20, 20, 0.86)', borderRadius: 1 }}
    >
      <LinearProgress data-testid="viewer-load-progress-bar" variant={determinate ? 'determinate' : 'indeterminate'} value={displayed} />
      <Typography data-testid="viewer-load-progress" variant="caption" sx={{ display: 'block', mt: 0.5, textAlign: 'center', color: 'grey.300' }}>{label ?? (determinate ? `${displayed}%` : t('loading'))}</Typography>
    </Box>
  );
}
