import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { ThemeOptions } from '@mui/material/styles';
import type { PdfitLanguage, PdfitLanguagePreferenceModel } from './model/languagePreference.js';
import type { PdfitMetadataCacheOptions } from './cache/metadataCache.js';

export interface PdfitSidebarItem {
  label: string;
  localizedLabels?: Partial<Record<PdfitLanguage, string>>;
  icon: ReactNode;
  path: string;
  placement?: 'header' | 'primary' | 'footer';
}

export interface PdfitFrontExtension {
  appName?: string;
  appVersion?: string;
  extraRoutes?: Array<{ path: string; element: ReactNode }>;
  extraSidebarItems?: PdfitSidebarItem[];
  extraSidebarFooter?: ReactNode;
  navigationGuard?: (path: string) => string;
  /** Whether the current account owns the paid AI metadata feature. */
  aiAutoTagAccess?: () => boolean;
  /** Maximum PDFs available to the current account in one bulk-tag action; null means unlimited. */
  aiBulkTagLimit?: () => number | null;
  /** AI 처리 후 서버 사용량을 새로 읽는다. 로컬 UI 미리보기는 별도 체험 카운터를 사용한다. */
  onAiTagProcessed?: (successful: number, documents?: Array<{ folder: string; filename: string; driveFileId?: string | null; assignedTag?: string }>) => Promise<void>;
  /** 실제 제거된 AI 태그 문서 자리를 반환한 뒤 사용량을 갱신한다. */
  onAiTagRemoved?: (removal: { folder?: string; filename?: string; driveFileId?: string | null; tag?: string }) => Promise<void>;
  /** Enables account-scoped book research and manual metadata editing. */
  bookMetadataEnabled?: boolean;
  /** Covers come from the server's thumbnail task (local or hosted) instead of a browser-side render. */
  serverThumbnails?: boolean;
  /** Whether the current account can use the server-managed AI book research feature. */
  bookResearchAccess?: () => boolean;
  themeOptions?: ThemeOptions;
  languagePreference?: {
    model: Pick<PdfitLanguagePreferenceModel, 'subscribe' | 'getVersion' | 'language' | 'setLanguage'>;
    labels: (language: PdfitLanguage) => Record<PdfitLanguage, string>;
    selectorLabel: (language: PdfitLanguage) => string;
    menuLabel: (language: PdfitLanguage) => string;
  };
  displayTranslation?: {
    translate: (texts: string[], language: PdfitLanguage) => Promise<string[]>;
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
  aiAutoTagAccess?: PdfitFrontExtension['aiAutoTagAccess'];
  aiBulkTagLimit?: PdfitFrontExtension['aiBulkTagLimit'];
  onAiTagProcessed?: PdfitFrontExtension['onAiTagProcessed'];
  onAiTagRemoved?: PdfitFrontExtension['onAiTagRemoved'];
  bookMetadataEnabled?: boolean;
  serverThumbnails?: boolean;
  bookResearchAccess?: PdfitFrontExtension['bookResearchAccess'];
  themeOptions?: ThemeOptions;
  languagePreference?: PdfitFrontExtension['languagePreference'];
  displayTranslation?: PdfitFrontExtension['displayTranslation'];
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
