import React, { useMemo, useSyncExternalStore } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import type { PdfitServiceExtension } from '../../shared/runtime.js';
import { PdfitFrontProvider } from '../../shared/runtime.js';
import { createPdfitBaseTheme } from '../../shared/theme.js';
import { pdfitAppearancePreferenceModel } from '../../../front/model/appearancePreference.js';
import PdfitServiceAppRoutes from '../../service/common/App.js';
import { PDFIT_LANGUAGES, pdfitLanguagePreferenceModel, type PdfitLanguage } from '../../../front/model/languagePreference.js';
import { configurePdfitMetadataCache, refreshPdfitMetadataCache } from '../../../front/cache/metadataCache.js';
import { configureMetadataOutbox } from '../../../front/cache/metadataOutbox.js';

export type { PdfitServiceExtension, PdfitSidebarItem } from '../../shared/runtime.js';
export type { PdfitLanguage } from '../../../front/model/languagePreference.js';
export { usePdfitI18n, useTranslatedDisplayText } from '../../../front/i18n/usePdfitI18n.js';

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
    aiAutoTagAccess: extension.aiAutoTagAccess,
    aiBulkTagLimit: extension.aiBulkTagLimit,
    onAiTagProcessed: extension.onAiTagProcessed,
    onAiTagRemoved: extension.onAiTagRemoved,
    bookMetadataEnabled: extension.bookMetadataEnabled,
    serverThumbnails: extension.serverThumbnails,
    bookResearchAccess: extension.bookResearchAccess,
    languagePreference: extension.languagePreference ?? defaultLanguagePreference,
    displayTranslation: extension.displayTranslation,
    themeOptions: extension.themeOptions,
    metadataCache: extension.metadataCache,
  };

  configurePdfitMetadataCache(config.metadataCache);
  configureMetadataOutbox(config.metadataCache ? { scope: config.metadataCache.scope, onFlushed: refreshPdfitMetadataCache } : undefined);

  return function PdfitServiceApp() {
    const appearanceVersion = useSyncExternalStore(pdfitAppearancePreferenceModel.subscribe, pdfitAppearancePreferenceModel.getVersion, pdfitAppearancePreferenceModel.getVersion);
    const theme = useMemo(() => createTheme(createPdfitBaseTheme(pdfitAppearancePreferenceModel.mode), config.themeOptions ?? {}), [appearanceVersion]);
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
