import React from 'react';
import { Box, Typography } from '@mui/material';
import { usePdfitI18n } from '../i18n/usePdfitI18n.js';

export const PDF_LIST_COLUMNS = '24px minmax(0, 2.75fr) 120px 76px 142px minmax(72px, .75fr)';
export const PDF_LIST_MOBILE_COLUMNS = '20px minmax(0, 1.3fr) 120px 76px 142px 72px';
export const PDF_LIST_FREE_COLUMNS = PDF_LIST_COLUMNS;
export const PDF_LIST_FREE_MOBILE_COLUMNS = PDF_LIST_MOBILE_COLUMNS;
export const PDF_LIST_COMPACT_MAX_WIDTH = 719;
export const PDF_LIST_WIDE_LAYOUT_QUERY = '(min-width: 900px), (min-width: 720px) and (pointer: coarse)';

/** Shared document headings and grid alignment; see docs/internals.md. */
export default function PdfListHeader({ compactTagActions = false }: { compactTagActions?: boolean }) {
  const { t, ui } = usePdfitI18n();
  return <Box data-testid="pdf-list-header" sx={{ display: 'grid', gridTemplateColumns: compactTagActions ? PDF_LIST_FREE_MOBILE_COLUMNS : PDF_LIST_MOBILE_COLUMNS, [`@media ${PDF_LIST_WIDE_LAYOUT_QUERY}`]: { gridTemplateColumns: compactTagActions ? PDF_LIST_FREE_COLUMNS : PDF_LIST_COLUMNS, px: '18px' }, columnGap: 1, px: '12px', py: 1, borderBottom: '1px solid', borderColor: 'divider', color: 'text.secondary' }}>
    <Box />
    <Typography variant="caption" fontWeight={650} sx={{ textAlign: 'left' }}>{ui('파일명')}</Typography>
    <Typography variant="caption" fontWeight={650} sx={{ textAlign: 'left' }}>{t('tags')}</Typography>
    <Typography variant="caption" fontWeight={650} sx={{ textAlign: 'left' }}>{t('documentInfo')}</Typography>
    <Typography variant="caption" fontWeight={650} sx={{ textAlign: 'left' }}>{t('documentTime')}</Typography>
    <Typography data-testid="pdf-file-size-header" variant="caption" fontWeight={650} sx={{ textAlign: 'left' }}>{t('fileSize')}</Typography>
  </Box>;
}
