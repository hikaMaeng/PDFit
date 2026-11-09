import React, { Component, Suspense, type ErrorInfo, type ReactNode } from 'react';
import { Box, Button, CircularProgress, IconButton, Stack, Typography } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import { Outlet } from 'react-router-dom';
import LNB from './LNB';

class RouteContentBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('PDFit route rendering failed.', error, info);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <Stack minHeight="60vh" alignItems="center" justifyContent="center" spacing={2} textAlign="center">
          <Typography variant="h6">화면을 불러오지 못했습니다.</Typography>
          <Typography color="text.secondary">페이지를 새로고침한 뒤 다시 시도해 주세요.</Typography>
          <Button variant="contained" onClick={() => window.location.reload()}>
            새로고침
          </Button>
        </Stack>
      );
    }

    return this.props.children;
  }
}

function RouteLoadingState() {
  return (
    <Stack minHeight="60vh" alignItems="center" justifyContent="center" spacing={2}>
      <CircularProgress size={32} />
      <Typography color="text.secondary">화면을 불러오는 중입니다.</Typography>
    </Stack>
  );
}

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
          <RouteContentBoundary>
            <Suspense fallback={<RouteLoadingState />}>
              <Outlet />
            </Suspense>
          </RouteContentBoundary>
        </Box>
      </Box>
    </Box>
  );
}
