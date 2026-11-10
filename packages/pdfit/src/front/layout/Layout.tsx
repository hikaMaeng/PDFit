import React, { Component, Suspense, type ErrorInfo, type ReactNode } from 'react';
import { Box, Button, CircularProgress, Fade, IconButton, Stack, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import { Outlet, useLocation } from 'react-router-dom';
import LNB from './LNB';
import { UNTAGGED_PATH } from '../model/untagged.js';
import { usePdfitI18n } from '../i18n/usePdfitI18n';

function RouteErrorState() {
  const { t } = usePdfitI18n();
  return (
    <Stack minHeight="60vh" alignItems="center" justifyContent="center" spacing={2} textAlign="center">
      <Typography variant="h6">{t('routeLoadFailed')}</Typography>
      <Typography color="text.secondary">{t('reloadAndRetry')}</Typography>
      <Button variant="contained" onClick={() => window.location.reload()}>{t('retry')}</Button>
    </Stack>
  );
}

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
      return <RouteErrorState />;
    }

    return this.props.children;
  }
}

function RouteLoadingState() {
  const { t } = usePdfitI18n();
  return (
    <Stack minHeight="60vh" alignItems="center" justifyContent="center" spacing={2}>
      <CircularProgress size={32} />
      <Typography color="text.secondary">{t('loadingScreen')}</Typography>
    </Stack>
  );
}

export default function Layout() {
  const { t, ui } = usePdfitI18n();
  const theme = useTheme();
  const isTabletDrawer = useMediaQuery('(min-width: 720px) and (max-width: 899.95px) and (pointer: coarse)');
  const location = useLocation();
  const isLibraryList = location.pathname.startsWith('/folder/') || location.pathname.startsWith('/tag/') || location.pathname === UNTAGGED_PATH || location.pathname === '/bookmarks';
  const mainBackground = 'background.default';
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [showScrollTop, setShowScrollTop] = React.useState(false);
  const mainRef = React.useRef<HTMLElement | null>(null);

  return (
    <Box sx={{ display: 'flex', height: '100dvh', overflow: 'hidden', backgroundColor: mainBackground }}>
      <LNB mobileOpen={mobileMenuOpen} onMobileClose={() => setMobileMenuOpen(false)} />
      <Box
        component="main"
        ref={mainRef}
        onScroll={(event) => setShowScrollTop(event.currentTarget.scrollTop > 480)}
        sx={{
          flexGrow: 1,
          height: '100%',
          boxSizing: 'border-box',
          px: { xs: 2, md: 2.5 },
          '--pdfit-main-padding-y': { xs: '6px', md: '12px' },
          py: 'var(--pdfit-main-padding-y)',
          overflow: 'auto',
          minWidth: 0,
          backgroundColor: mainBackground,
        }}
      >
        <Box sx={{ display: { xs: 'flex', md: 'none' }, alignItems: 'center', gap: 1, mb: 1.5, minHeight: 40, ...(isTabletDrawer ? { position: 'sticky', top: 0, zIndex: theme.zIndex.appBar, bgcolor: mainBackground, borderBottom: '1px solid', borderColor: 'divider' } : {}) }}>
          <IconButton aria-label={t('openMenu')} onClick={() => setMobileMenuOpen(true)} size="small">
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
        <Fade in={showScrollTop}>
          <Box sx={{ position: 'fixed', right: { xs: 18, md: 28 }, bottom: { xs: 18, md: 28 }, zIndex: 20 }}>
            <Tooltip title={ui("맨 위로")} placement="left" arrow>
              <IconButton
                data-testid="scroll-to-top"
                aria-label={ui("맨 위로")}
                onClick={() => mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
                sx={{
                  width: 46,
                  height: 46,
                  color: 'primary.main',
                  bgcolor: 'background.paper',
                  border: '2px solid',
                  borderColor: 'primary.main',
                  borderRadius: '50%',
                  boxShadow: '0 6px 18px rgba(0, 0, 0, .24)',
                  '&:hover': { color: 'primary.dark', bgcolor: 'action.hover', borderColor: 'primary.dark', transform: 'translateY(-2px)', boxShadow: '0 8px 22px rgba(0, 0, 0, .3)' },
                  '&:focus-visible': { outline: '3px solid', outlineColor: 'primary.light', outlineOffset: 2 },
                  '& svg': { fontSize: 28, stroke: 'currentColor', strokeWidth: 0.5 },
                }}
              >
                <KeyboardArrowUpIcon />
              </IconButton>
            </Tooltip>
          </Box>
        </Fade>
      </Box>
    </Box>
  );
}
