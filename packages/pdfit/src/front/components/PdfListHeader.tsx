import { Box, Typography } from '@mui/material';
import { usePdfitI18n } from '../i18n/usePdfitI18n.js';

const COMPACT_LIST = '@media (max-width: 599px)';

export const PDF_LIST_GRID_SX = {
  display: 'grid',
  gridTemplateColumns: '48px minmax(0, 1fr) 88px 180px',
  gridTemplateAreas: '"cover name size actions"',
  alignItems: 'center',
  columnGap: 1,
  px: '18px',
  [COMPACT_LIST]: {
    gridTemplateColumns: '42px minmax(0, 1fr) 72px',
    gridTemplateAreas: '"cover name size" "cover actions actions"',
    px: '8px',
  },
} as const;

export default function PdfListHeader() {
  const { t, ui } = usePdfitI18n();
  return <Box data-testid="pdf-list-header" sx={{
    ...PDF_LIST_GRID_SX, [COMPACT_LIST]: { ...PDF_LIST_GRID_SX[COMPACT_LIST], gridTemplateAreas: '"cover name size"' },
    py: 1, borderBottom: '1px solid', borderColor: 'divider', color: 'text.secondary',
  }}>
    <Typography variant="caption" fontWeight={650} sx={{ gridArea: 'name' }}>{ui('파일명')}</Typography>
    <Typography data-testid="pdf-file-size-header" variant="caption" fontWeight={650} sx={{ gridArea: 'size' }}>{t('fileSize')}</Typography>
  </Box>;
}
