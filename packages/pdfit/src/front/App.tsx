import { lazy, useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { usePdfitFrontConfig } from './context.js';
import Layout from './layout/Layout';
import FolderPage from './pages/FolderPage';
import HomePage from './pages/HomePage';
import BackgroundSyncIndicator from './components/BackgroundSyncIndicator.js';

const PdfViewerPage = lazy(() => import('./pages/PdfViewerPage.js'));
const TagPage = lazy(() => import('./pages/TagPage.js'));
const BookmarkPage = lazy(() => import('./pages/BookmarkPage.js'));

function warmRouteModulesAfterFirstPaint(): () => void {
  const warm = () => {
    // Route code and PDF.js are allowed to download immediately, but no
    // initial render waits for either import to finish.
    void import('./pdfjs.js').then(({ loadPdfJs }) => loadPdfJs());
    void import('./pages/PdfViewerPage.js');
    void import('./pages/TagPage.js');
    void import('./pages/BookmarkPage.js');
  };

  // Warm only after the initial shell data has rendered. This is render-driven
  // rather than an arbitrary time delay, and PDF.js still loads automatically.
  const onInitialRendered = () => window.requestAnimationFrame(warm);
  window.addEventListener('pdfit-initial-rendered', onInitialRendered, { once: true });

  return () => {
    window.removeEventListener('pdfit-initial-rendered', onInitialRendered);
  };
}

export default function App() {
  const { extraRoutes } = usePdfitFrontConfig();

  // Start heavy route/PDF.js downloads after the first browser paint. This
  // keeps the first screen responsive while warming the viewer in parallel.
  useEffect(() => warmRouteModulesAfterFirstPaint(), []);

  return (
    <>
      <BackgroundSyncIndicator />
      <Routes>
        <Route path="/viewer/:folder/:filename" element={<PdfViewerPage />} />
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/folder/:name" element={<FolderPage />} />
          <Route path="/bookmarks" element={<BookmarkPage />} />
          <Route path="/tag/:name" element={<TagPage />} />
          {extraRoutes.map((route) => (
            <Route key={route.path} path={route.path} element={route.element} />
          ))}
        </Route>
      </Routes>
    </>
  );
}
