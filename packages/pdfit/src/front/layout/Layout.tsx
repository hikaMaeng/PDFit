import React, { Suspense } from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import { Outlet } from 'react-router-dom';
import LNB from './LNB';

export default function Layout() {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', backgroundColor: 'background.default' }}>
      <LNB mobileOpen={mobileMenuOpen} onMobileClose={() => setMobileMenuOpen(false)} />
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minHeight: '100vh',
          px: { xs: 2, md: 2.5 },
          py: { xs: 0.75, md: 1.5 },
          overflow: 'auto',
          minWidth: 0,
          backgroundColor: '#18181b',
        }}
      >
        <Box sx={{ display: { xs: 'flex', md: 'none' }, alignItems: 'center', gap: 1, mb: 1.5, minHeight: 40 }}>
          <IconButton aria-label="메뉴 열기" onClick={() => setMobileMenuOpen(true)} size="small">
            <MenuIcon />
          </IconButton>
          <Box component="img" src="/brand/pdfit-logo-dark.png" alt="" aria-hidden="true" sx={{ width: 36, height: 36, objectFit: 'contain' }} />
          <Typography variant="subtitle1" fontWeight={700}>PDFit</Typography>
        </Box>
        <Box sx={{ width: '100%', maxWidth: 1680, mx: 'auto' }}>
          <Suspense fallback={null}>
            <Outlet />
          </Suspense>
        </Box>
      </Box>
    </Box>
  );
}
