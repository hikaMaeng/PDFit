# API

## Client Service

`createPdfitServiceApp(extension)` from `@pdfit/pdfit/client/service`

Extension fields:

* `appName`
* `appVersion`
* `extraRoutes`
* `extraSidebarItems`: `{ label, icon, path, placement? }` items. `placement:
  'primary'` renders a full-width navigation row above Bookmarks; omitted or
  `header` renders the existing compact header icon.
* `themeOptions`
* `metadataCache`: optional `{ scope, bootstrapUrl }` adapter for account-scoped
  IndexedDB hydration and folder/PDF list reads

When the adapter is configured, tag, progress, viewer-state, and bookmark reads use the
same cache. Tag changes update IndexedDB before the service request; progress and viewer
state remote writes use a 750 ms debounce.

## Client Viewer

`createPdfitViewerApp(extension)` from `@pdfit/pdfit/client/viewer`

The viewer page uses the `PdfGpuViewer` adapter and the independently versioned
`@pdfgpu/core` package. PDFit exposes the existing viewer state callbacks and
falls back to the PDF.js viewer when the PDFium/WebGPU path cannot initialize.

The exact core artifact, source commit, and SHA-256 are recorded in
`packages/pdfit/vendor/pdfgpu-build.json`; the released package resolves its
PDFium WASM dependency through `@embedpdf/pdfium@2.14.0`.

The viewer header exposes direct PDF download through the existing same-origin
file route without rewriting the source. The confirmation dialog intentionally
offers no alternate Markdown or JSON data formats.

Extension fields:

* `appName`
* `appVersion`
* `basename`
* `themeOptions`
* `metadataCache`: optional `{ scope, bootstrapUrl }` adapter shared with the service
  entry so a dedicated viewer can resolve account-scoped IndexedDB state

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
the adapter owns only remote storage operations. An adapter may implement
`getFileById` and `openFileById` to expose `GET /by-id/:driveFileId`; common code
validates the identifier and Range response while the adapter verifies ownership.
An authenticated adapter may additionally implement `openThumbnailById` to expose
`GET /by-id/:driveFileId/thumbnail`. The common route proxies the image with private
browser caching, so remote credentials and short-lived provider URLs never reach the
client.

Adapters may also implement `createResumableUploadSession` and
`completeResumableUpload`. The common router then exposes metadata-only session and
completion routes while the browser uploads PDF chunks directly to the returned remote
session. Adapters without those methods retain the multipart compatibility endpoint.

## PostgreSQL

`createPostgresMetadataStore(pool)` initializes the shared metadata schema in the
embedded PostgreSQL/pgvector database for tags, reading progress, and viewer
state.

`migrateSqliteMetadata(sqlitePath, pool)` is a one-time compatibility path for
existing installations. After a successful import it renames the source file to
`app.db.migrated-<timestamp>` instead of deleting it.

## Tag endpoints

The shared tags router in [`src/server/routes/tags.ts`](../src/server/routes/tags.ts) keeps `/api/tags` as the string-list compatibility endpoint, adds `GET /api/tags/summary` with `{ name, bookCount }` rows for the sidebar, and supports `DELETE /api/tags/:tag` to remove the tag and all `book_tags` links through the database cascade.

`POST /api/tags/book/:folder/:filename/auto` derives the book title from the PDF filename, selects one to three reusable bookstore categories, persists only new normalized tags, and returns `title`, `suggestedTags`, and `addedTags`. A configured OpenAI-compatible endpoint supplies semantic classification, but its output is restricted to the shared bookstore taxonomy. Without one, the shared zero-configuration category classifier is used so local and hosted Docker runtimes remain functional.

`POST /api/tags/folder/:folder/auto` accepts 1-500 `{ filename, driveFileId? }` book references, classifies them with concurrency limited to three, and persists all successful tag relations through one metadata batch when the storage adapter supports it. The response includes processed/failed counts, the total number of added tags, per-book results, and per-book classifier errors.

## Bookmark endpoints

`GET /api/bookmarks` returns every persisted bookmark newest-first for the
library route. `GET /api/bookmarks/:folder/:filename` remains the viewer's
book-local query. Both return `BookmarkRecord`; `POST`, `PATCH`, and `DELETE`
remain the capture/edit lifecycle endpoints in
[`src/server/api/bookmarks/index.ts`](../src/server/api/bookmarks/index.ts).
