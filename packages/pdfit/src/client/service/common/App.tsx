import { lazy, useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { usePdfitFrontConfig } from '../../../front/context.js';
import Layout from '../../../front/layout/Layout.js';
import HomePage from '../../../front/pages/HomePage.js';

const FolderPage = lazy(() => import('../../../front/pages/FolderPage.js'));
const TagPage = lazy(() => import('../../../front/pages/TagPage.js'));
const BookmarkPage = lazy(() => import('../../../front/pages/BookmarkPage.js'));

function warmRouteModulesAfterFirstPaint(): () => void {
  const warm = () => {
    // Start route code and PDF.js after the first paint. The initial service
    // shell never waits for these imports to resolve.
    void import('../../../front/pdfjs.js').then(({ loadPdfJs }) => loadPdfJs());
    void import('../../../front/pages/FolderPage.js');
    void import('../../../front/pages/TagPage.js');
    void import('../../../front/pages/BookmarkPage.js');
  };

  // Warm only after the initial shell data has rendered. This is render-driven
  // rather than an arbitrary time delay, and PDF.js still loads automatically.
  const onInitialRendered = () => window.requestAnimationFrame(warm);
  window.addEventListener('pdfit-initial-rendered', onInitialRendered, { once: true });

  return () => {
    window.removeEventListener('pdfit-initial-rendered', onInitialRendered);
  };
}

export default function PdfitServiceAppRoutes() {
  const { extraRoutes } = usePdfitFrontConfig();

  useEffect(() => warmRouteModulesAfterFirstPaint(), []);

  return (
    <Routes>
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
  );
}
