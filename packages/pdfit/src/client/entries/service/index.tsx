import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import type { PdfitServiceExtension } from '../../shared/runtime.js';
import { PdfitFrontProvider } from '../../shared/runtime.js';
import { pdfitBaseTheme } from '../../shared/theme.js';
import PdfitServiceAppRoutes from '../../service/common/App.js';
import { PDFIT_LANGUAGES, pdfitLanguagePreferenceModel, type PdfitLanguage } from '../../../front/model/languagePreference.js';

export type { PdfitServiceExtension, PdfitSidebarItem } from '../../shared/runtime.js';
export type { PdfitLanguage } from '../../../front/model/languagePreference.js';

export function createPdfitServiceApp(extension: PdfitServiceExtension = {}) {
  const defaultLanguagePreference = {
    model: pdfitLanguagePreferenceModel,
    labels: () => Object.fromEntries(PDFIT_LANGUAGES.map((language) => [language, language.toUpperCase()])) as Record<PdfitLanguage, string>,
    selectorLabel: () => 'Language',
    menuLabel: () => 'Language selection',
  };
  const config = {
    appName: extension.appName ?? 'PDFit',
    appVersion: extension.appVersion ?? '0.0.0',
    extraRoutes: extension.extraRoutes ?? [],
    extraSidebarItems: extension.extraSidebarItems ?? [],
    extraSidebarFooter: extension.extraSidebarFooter,
    navigationGuard: extension.navigationGuard,
    languagePreference: extension.languagePreference ?? defaultLanguagePreference,
    themeOptions: extension.themeOptions,
  };

  const theme = createTheme(pdfitBaseTheme, config.themeOptions ?? {});

  return function PdfitServiceApp() {
    return (
      <React.StrictMode>
        <PdfitFrontProvider value={config}>
          <ThemeProvider theme={theme}>
            <CssBaseline />
            <BrowserRouter>
              <PdfitServiceAppRoutes />
            </BrowserRouter>
          </ThemeProvider>
        </PdfitFrontProvider>
      </React.StrictMode>
    );
  };
}
