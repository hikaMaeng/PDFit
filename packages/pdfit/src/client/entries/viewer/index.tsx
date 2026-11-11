import React, { useMemo, useSyncExternalStore } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import type { PdfitViewerExtension } from '../../shared/runtime.js';
import { PdfitFrontProvider } from '../../shared/runtime.js';
import { createPdfitBaseTheme } from '../../shared/theme.js';
import { pdfitAppearancePreferenceModel } from '../../../front/model/appearancePreference.js';
import PdfitViewerAppRoutes from '../../viewer/common/App.js';
import { configurePdfitMetadataCache, refreshPdfitMetadataCache } from '../../../front/cache/metadataCache.js';
import { configureMetadataOutbox } from '../../../front/cache/metadataOutbox.js';
import { PDFIT_LANGUAGES, pdfitLanguagePreferenceModel, type PdfitLanguage } from '../../../front/model/languagePreference.js';
import { ensureCredentialFreeBase } from '../../../front/api/credentialFreeBase.js';

export type { PdfitViewerExtension } from '../../shared/runtime.js';
export { usePdfitI18n, useTranslatedDisplayText } from '../../../front/i18n/usePdfitI18n.js';

export function createPdfitViewerApp(extension: PdfitViewerExtension = {}) {
  ensureCredentialFreeBase();
  const defaultLanguagePreference = {
    model: pdfitLanguagePreferenceModel,
    labels: () => Object.fromEntries(PDFIT_LANGUAGES.map((language) => [language, language.toUpperCase()])) as Record<PdfitLanguage, string>,
    selectorLabel: () => 'Language',
    menuLabel: () => 'Language selection',
  };
  configurePdfitMetadataCache(extension.metadataCache);
  configureMetadataOutbox(extension.metadataCache ? { scope: extension.metadataCache.scope, onFlushed: refreshPdfitMetadataCache } : undefined);
  const config = {
    appName: extension.appName ?? 'PDFit',
    appVersion: extension.appVersion ?? '0.0.0',
    extraRoutes: [],
    extraSidebarItems: [],
    themeOptions: extension.themeOptions,
    languagePreference: extension.languagePreference ?? defaultLanguagePreference,
    displayTranslation: extension.displayTranslation,
    bookMetadataEnabled: extension.bookMetadataEnabled,
    bookResearchAccess: extension.bookResearchAccess,
  };

  return function PdfitViewerApp() {
    const appearanceVersion = useSyncExternalStore(pdfitAppearancePreferenceModel.subscribe, pdfitAppearancePreferenceModel.getVersion, pdfitAppearancePreferenceModel.getVersion);
    const theme = useMemo(() => createTheme(createPdfitBaseTheme(pdfitAppearancePreferenceModel.mode), config.themeOptions ?? {}), [appearanceVersion]);
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
