import React from 'react';
import { Typography, Box } from '@mui/material';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';

export default function BooksPage() {
  return (
    <Box>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        책 목록
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
        <Typography variant="body1">구글 드라이브 연동 후 PDF 목록이 표시됩니다.</Typography>
      </Box>
    </Box>
  );
}
