import cors from 'cors';
import express, { type ErrorRequestHandler, type Express, type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { MetadataStore } from '../../shared/index.js';
import {
  createPdfitCommonRouterAssembly,
  type PdfitServerRouterMount,
} from './createCommonRouters.js';

export interface PdfitServerOptions {
  metadataStore?: MetadataStore;
  booksRoot?: string;
  bookmarkAssetRoot?: string;
  booksRootName?: string;
  staticDir: string;
  logLabel: string;
  extraRouters?: PdfitServerRouterMount[];
  watcherEnabled?: boolean;
  serviceIndexFile?: string;
  viewerIndexFile?: string;
  viewerBasePath?: string;
  maxUploadBytes?: number;
  commonRouters?: PdfitServerRouterMount[];
  configureApp?: (app: Express) => void;
  defaultMiddlewareEnabled?: boolean;
  errorHandlers?: ErrorRequestHandler[];
}

const SILENT_PATTERNS = [
  /^PUT \/api\/viewer-state\//,
  /^PUT \/api\/progress\//,
  /^GET \/api\//,
  /^GET \//,
];

export type { PdfitServerRouterMount } from './createCommonRouters.js';

export function createPdfitServer(options: PdfitServerOptions): Express {
  const {
    metadataStore,
    booksRoot,
    booksRootName,
    staticDir,
    logLabel,
    extraRouters = [],
    watcherEnabled = true,
    serviceIndexFile = 'index.html',
    viewerIndexFile = path.join('viewer', 'index.html'),
    viewerBasePath = '/viewer',
  } = options;

  const routers = options.commonRouters ?? (() => {
    if (!metadataStore || !booksRoot) throw new Error('metadataStore and booksRoot are required for the local PDFit runtime.');
    return createPdfitCommonRouterAssembly({
      metadataStore,
      booksRoot,
      bookmarkAssetRoot: options.bookmarkAssetRoot,
      booksRootName,
      watcherEnabled,
      maxUploadBytes: options.maxUploadBytes,
    }).routers;
  })();

  const app = express();
  options.configureApp?.(app);
  if (options.defaultMiddlewareEnabled ?? true) {
    app.use(cors());
    app.use(express.json({ limit: '20mb' }));
  }

  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    const key = `${req.method} ${req.path}`;

    res.on('finish', () => {
      const ms = Date.now() - start;
      const status = res.statusCode;
      const isSilent = SILENT_PATTERNS.some((pattern) => pattern.test(key));
      if (isSilent && status < 400) {
        return;
      }
      const level = status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO';
      console.log(`[${logLabel}] ${level} ${req.method} ${req.path} ${status} (${ms}ms)`);
    });

    next();
  });

  for (const routerMount of [...routers, ...extraRouters]) {
    app.use(routerMount.path, routerMount.router);
  }

  app.get('/health', (_req, res) => {
    res.status(200).json({ ok: true, service: logLabel });
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  if (fs.existsSync(staticDir)) {
    const serviceIndexPath = path.join(staticDir, serviceIndexFile);
    const viewerIndexPath = path.join(staticDir, viewerIndexFile);
    const viewerTargets = [viewerBasePath, `${viewerBasePath}/*`];

    app.use(express.static(staticDir));

    if (fs.existsSync(viewerIndexPath)) {
      app.get(viewerTargets, (_req, res) => {
        res.sendFile(viewerIndexPath);
      });
    }

    app.get('*', (_req, res) => {
      res.sendFile(serviceIndexPath);
    });
  } else {
    app.get('*', (_req, res) => {
      res.status(200).send('Development mode: use the front-end dev server.');
    });
  }

  for (const errorHandler of options.errorHandlers ?? []) app.use(errorHandler);

  return app;
}

export { createPdfitMetadataRouterMounts } from './createCommonRouters.js';
export type { MetadataStoreResolver } from '../routes/metadataStoreResolver.js';
export { createPdfitRemoteFoldersRouter, parsePdfitByteRange } from '../routes/remoteFolders.js';
export type { PdfitRemoteFile, PdfitRemoteFoldersRouterOptions, PdfitRemoteLibraryAdapter, PdfitRemoteRefreshResult, PdfitResumableUploadSession } from '../routes/remoteFolders.js';
