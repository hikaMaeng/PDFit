import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { ThemeOptions } from '@mui/material/styles';
import type { PdfitLanguage, PdfitLanguagePreferenceModel } from './model/languagePreference.js';
import type { PdfitMetadataCacheOptions } from './cache/metadataCache.js';

export interface PdfitSidebarItem {
  label: string;
  icon: ReactNode;
  path: string;
}

export interface PdfitFrontExtension {
  appName?: string;
  appVersion?: string;
  extraRoutes?: Array<{ path: string; element: ReactNode }>;
  extraSidebarItems?: PdfitSidebarItem[];
  extraSidebarFooter?: ReactNode;
  navigationGuard?: (path: string) => string;
  themeOptions?: ThemeOptions;
  languagePreference?: {
    model: Pick<PdfitLanguagePreferenceModel, 'subscribe' | 'getVersion' | 'language' | 'setLanguage'>;
    labels: (language: PdfitLanguage) => Record<PdfitLanguage, string>;
    selectorLabel: (language: PdfitLanguage) => string;
    menuLabel: (language: PdfitLanguage) => string;
  };
  metadataCache?: PdfitMetadataCacheOptions;
}

export interface PdfitFrontRuntimeConfig {
  appName: string;
  appVersion: string;
  extraRoutes: Array<{ path: string; element: ReactNode }>;
  extraSidebarItems: PdfitSidebarItem[];
  extraSidebarFooter?: ReactNode;
  navigationGuard?: (path: string) => string;
  themeOptions?: ThemeOptions;
  languagePreference?: PdfitFrontExtension['languagePreference'];
  metadataCache?: PdfitMetadataCacheOptions;
}

const PdfitFrontContext = createContext<PdfitFrontRuntimeConfig>({
  appName: 'PDFit',
  appVersion: '0.0.0',
  extraRoutes: [],
  extraSidebarItems: [],
});

export function PdfitFrontProvider(props: {
  value: PdfitFrontRuntimeConfig;
  children: ReactNode;
}) {
  return <PdfitFrontContext.Provider value={props.value}>{props.children}</PdfitFrontContext.Provider>;
}

export function usePdfitFrontConfig(): PdfitFrontRuntimeConfig {
  return useContext(PdfitFrontContext);
}
