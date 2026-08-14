import { Component, lazy, Suspense, type ReactNode } from 'react';
import { Alert, Box, CircularProgress, Typography } from '@mui/material';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import { Route, Routes } from 'react-router-dom';

const PdfViewerPage = lazy(() => import('../../../front/pages/PdfViewerPage.js'));

class ViewerErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <Box component="main" sx={{ p: 3 }}><Alert severity="error">뷰어를 불러오지 못했습니다: {this.state.error.message}</Alert></Box>;
    }
    return this.props.children;
  }
}

function ViewerLanding() {
  return (
    <Box
      component="main"
      sx={{
        display: 'flex',
        minHeight: '100vh',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        px: 3,
        textAlign: 'center',
      }}
    >
      <MenuBookIcon sx={{ fontSize: 72, color: 'primary.main', opacity: 0.75 }} />
      <Typography variant="h4" fontWeight={700}>
        PDF Viewer
      </Typography>
      <Typography color="text.secondary">
        Select a PDF from the service app to open the dedicated viewer entry.
      </Typography>
    </Box>
  );
}

export default function PdfitViewerAppRoutes() {
  return (
    <ViewerErrorBoundary>
      <Suspense fallback={<Box component="main" sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>}>
        <Routes>
          <Route path="/" element={<ViewerLanding />} />
          <Route path="/:folder/:filename" element={<PdfViewerPage />} />
        </Routes>
      </Suspense>
    </ViewerErrorBoundary>
  );
}
