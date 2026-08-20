# API

## Client Service

`createPdfitServiceApp(extension)` from `@pdfit/pdfit/client/service`

Extension fields:

* `appName`
* `appVersion`
* `extraRoutes`
* `extraSidebarItems`
* `themeOptions`
* `metadataCache`: optional `{ scope, bootstrapUrl }` adapter for account-scoped
  IndexedDB hydration and folder/PDF list reads

## Client Viewer

`createPdfitViewerApp(extension)` from `@pdfit/pdfit/client/viewer`

The viewer page uses the `PdfGpuViewer` adapter and the independently versioned
`@pdfgpu/core` package. PDFit exposes the existing viewer state callbacks and
falls back to the PDF.js viewer when the PDFium/WebGPU path cannot initialize.

The exact core artifact, source commit, and SHA-256 are recorded in
`packages/pdfit/vendor/pdfgpu-build.json`; the released package resolves its
PDFium WASM dependency through `@embedpdf/pdfium@2.14.0`.

Extension fields:

* `appName`
* `appVersion`
* `basename`
* `themeOptions`

## Client Shared

`@pdfit/pdfit/client/shared`

Exports:

* `PdfitServiceExtension`
* `PdfitViewerExtension`
* `PdfitSidebarItem`
* `pdfitBaseTheme`

## Server

`createPdfitServer(options)`

Options:

* `metadataStore`
* `booksRoot`
* `staticDir`
* `logLabel`
* `extraRouters`
* `watcherEnabled`
* `serviceIndexFile`
* `viewerIndexFile`
* `viewerBasePath`

App-owned routers use the `extraRouters` option as `{ path, router }` mounts.

The server bootstrap also accepts `commonRouters`, `configureApp`, and
`defaultMiddlewareEnabled` so authenticated hosted runtimes reuse PDFit's
logging, health, static service/viewer entries, and API fallback.

`createPdfitMetadataRouterMounts(storeResolver, eventBus)` builds the canonical
progress, tags, viewer-state, bookmarks, and SSE routes. The resolver may
return an account-scoped `MetadataStore` for each request.

`createPdfitRemoteFoldersRouter(adapter, options)` owns folder/file HTTP
validation, multipart upload handling, byte ranges, and response contracts;
the adapter owns only remote storage operations.

## PostgreSQL

`createPostgresMetadataStore(pool)` initializes the shared metadata schema in the
embedded PostgreSQL/pgvector database for tags, reading progress, and viewer
state.

`migrateSqliteMetadata(sqlitePath, pool)` is a one-time compatibility path for
existing installations. After a successful import it renames the source file to
`app.db.migrated-<timestamp>` instead of deleting it.

## Tag endpoints

The shared tags router in [`src/server/routes/tags.ts`](../src/server/routes/tags.ts) keeps `/api/tags` as the string-list compatibility endpoint, adds `GET /api/tags/summary` with `{ name, bookCount }` rows for the sidebar, and supports `DELETE /api/tags/:tag` to remove the tag and all `book_tags` links through the database cascade.

## Bookmark endpoints

`GET /api/bookmarks` returns every persisted bookmark newest-first for the
library route. `GET /api/bookmarks/:folder/:filename` remains the viewer's
book-local query. Both return `BookmarkRecord`; `POST`, `PATCH`, and `DELETE`
remain the capture/edit lifecycle endpoints in
[`src/server/api/bookmarks/index.ts`](../src/server/api/bookmarks/index.ts).
