import { PdfitFrontProvider, type PdfitFrontExtension, type PdfitSidebarItem } from '../../front/context.js';
import type { ThemeOptions } from '@mui/material/styles';
import type { PdfitMetadataCacheOptions } from '../../front/cache/metadataCache.js';

export type { PdfitSidebarItem };
export { PdfitFrontProvider };

export type PdfitServiceExtension = PdfitFrontExtension;

export interface PdfitViewerExtension {
  appName?: string;
  appVersion?: string;
  basename?: string;
  themeOptions?: ThemeOptions;
  metadataCache?: PdfitMetadataCacheOptions;
}
