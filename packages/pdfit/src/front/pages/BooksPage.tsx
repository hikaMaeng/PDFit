import React from 'react';
import { Typography, Box } from '@mui/material';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import { usePdfitI18n } from '../i18n/usePdfitI18n';

export default function BooksPage() {
  const { t } = usePdfitI18n();
  return (
    <Box>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        {t('bookList')}
      </Typography>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '50vh',
          gap: 2,
          color: 'text.secondary',
        }}
      >
        <FolderOpenIcon sx={{ fontSize: 60, opacity: 0.4 }} />
        <Typography variant="body1">{t('connectDriveHint')}</Typography>
      </Box>
    </Box>
  );
}
