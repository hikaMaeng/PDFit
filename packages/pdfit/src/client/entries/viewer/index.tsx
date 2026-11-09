import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import type { PdfitViewerExtension } from '../../shared/runtime.js';
import { PdfitFrontProvider } from '../../shared/runtime.js';
import { pdfitBaseTheme } from '../../shared/theme.js';
import PdfitViewerAppRoutes from '../../viewer/common/App.js';
import { configurePdfitMetadataCache, refreshPdfitMetadataCache } from '../../../front/cache/metadataCache.js';
import { configureMetadataOutbox } from '../../../front/cache/metadataOutbox.js';

export type { PdfitViewerExtension } from '../../shared/runtime.js';

export function createPdfitViewerApp(extension: PdfitViewerExtension = {}) {
  configurePdfitMetadataCache(extension.metadataCache);
  configureMetadataOutbox(extension.metadataCache ? { scope: extension.metadataCache.scope, onFlushed: refreshPdfitMetadataCache } : undefined);
  const config = {
    appName: extension.appName ?? 'PDFit',
    appVersion: extension.appVersion ?? '0.0.0',
    extraRoutes: [],
    extraSidebarItems: [],
    themeOptions: extension.themeOptions,
  };

  const theme = createTheme(pdfitBaseTheme, config.themeOptions ?? {});

  return function PdfitViewerApp() {
    return (
      <React.StrictMode>
        <PdfitFrontProvider value={config}>
          <ThemeProvider theme={theme}>
            <CssBaseline />
            <BrowserRouter basename={extension.basename ?? '/viewer'}>
              <PdfitViewerAppRoutes />
            </BrowserRouter>
          </ThemeProvider>
        </PdfitFrontProvider>
      </React.StrictMode>
    );
  };
}
