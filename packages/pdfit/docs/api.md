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
* `serverThumbnails`: `true` on the local runtime. Covers of files without a
  `driveFileId` are then `<img>` elements pointing at the server thumbnail route, and
  the browser never renders those PDFs itself. Hosted runtimes leave it unset.
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

* `backgroundTasks`: local runtime only. `{ thumbnailRoot, intervalMs?, concurrency?,
  initialDelayMs?, cooldownMs?, autoStart? }` starts the periodic task scheduler
  (defaults: one hour, 2 workers, 30 s, 0 ms). Omit it to run without background work.

App-owned routers use the `extraRouters` option as `{ path, router }` mounts.

`@pdfit/pdfit/server` also exports the background-task building blocks for any
runtime: `createPdfitTaskScheduler`, `readPdfitTaskSchedulerEnvironment`,
`createTasksRouter`, `TaskScheduler`, `defineTask`, `DEFAULT_TASK_PRIORITY`,
`INTERACTIVE_TASK_PRIORITY`, the shared render script `THUMBNAIL_TASK_SCRIPT_URL` with
`THUMBNAIL_WIDTH`, `THUMBNAIL_JPEG_QUALITY`, `THUMBNAIL_FORMAT_VERSION`, and the types
`PdfitTaskSchedulerOptions`, `PeriodicTaskDefinition`, `PlannedTask`, `TaskEnvelope`,
`TaskScript`, `TaskOutcome`, `TaskSchedulerStatus`, `ThumbnailTaskPayload`,
`ThumbnailTaskSource`, `ThumbnailTaskResult`. See `internals.md`, "Background tasks".

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
client. The adapter may set `cacheControl` on the image (for a URL versioned with
`?v=<mtimeMs>-<size>`), or return `{ state: 'queued' | 'failed' | 'missing' }` instead
of an image; the route then answers `202 { state: 'queued' }` or `404 { state }`, the
same contract as the local thumbnail route. With `serverThumbnails` set, the cover
card uses that contract for remote files too.

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

`GET /api/tags/index` returns `TagIndexEntry[]` (`{ name, color, books: [{ folder, filename }] }`) for every tag that has at least one book, from the optional `MetadataStore.listTagIndex()` (answers `501` otherwise). The PostgreSQL implementation reads tags, `book_tags` and `books` in one query with the same rule as `listBooksByTag` (a link whose `books` row is gone is not counted), so a card's book count equals the sidebar `bookCount` and the `GET /api/tags/:tag/books` length. It is a single segment on purpose: a real tag named `index` is still read through `GET /api/tags/:tag/books`. The hydrated browser cache (`listCachedTagIndex`) computes the same grouping locally for the hosted runtime.

`GET /api/tags/untagged-books` returns the books with no `book_tags` row (`TaggedBookRecord[]`, `tags: []`) and `GET /api/tags/untagged-count` returns `{ count }`; both come from the optional `MetadataStore.listUntaggedBooks()` / `countUntaggedBooks()` and answer `501` for stores that do not implement them. The paths are single segments on purpose: a real tag named `untagged-books` is still read through `GET /api/tags/:tag/books`. The hydrated browser cache (`listCachedUntaggedBooks`) computes the same set locally, so the hosted runtime needs no server route.

`POST /api/tags/book/:folder/:filename/auto` derives the book title from the PDF filename, selects one to three reusable bookstore categories, persists only new normalized tags, and returns `title`, `suggestedTags`, and `addedTags`. A configured OpenAI-compatible endpoint supplies semantic classification, but its output is restricted to the shared bookstore taxonomy. Without one, the shared zero-configuration category classifier is used so local and hosted Docker runtimes remain functional.

`POST /api/tags/folder/:folder/auto` accepts 1-500 `{ filename, driveFileId? }` book references, classifies them with concurrency limited to three, and persists all successful tag relations through one metadata batch when the storage adapter supports it. The response includes processed/failed counts, the total number of added tags, per-book results, and per-book classifier errors.

## Title search endpoint

`GET /api/search/books?q=<text>[&limit=<n>]` ([`src/server/routes/search.ts`](../src/server/routes/search.ts)) searches book titles in the metadata database, not the file system. The `books` table is the one `syncBooks` keeps in step with the library, so a PDF that is not indexed yet is not found until the next refresh.

* Scope: the title only, i.e. the filename without `.pdf`. Folder names and tags are not searched.
* Match: one substring of the trimmed query, case-insensitive. Both sides are normalized to NFC so a macOS-style NFD filename matches an NFC query. The query is compared with `position()`, so `%` and `_` are literal characters.
* Initials: `books.title_choseong` holds the title with every Hangul syllable replaced by its initial consonant, whitespace removed and the rest lowercased (`이것이 자바다.pdf` → `ㅇㄱㅇㅈㅂㄷ`, `Do it!SQL 입문.pdf` → `doit!sqlㅇㅁ`). A book matches when the query is a substring of the title **or** of this field. The query is compared with that field after lowercasing and removing whitespace but without converting syllables, so `ㅈㅂ` finds `자바` and `정보`, while `자바` does not match `정보`.
* `q` is required and at most 200 characters; otherwise `400`. A metadata store without `searchBooksByTitle` answers `501`.
* Response: `{ query, total, books }`. `books` are `{ folder, filename, size, modified_at, tags }` ordered by filename then folder and capped at `limit` (default 500, at most 2000); `total` is the uncapped match count.

`title_choseong` is derived by `titleChoseong()` in [`src/shared/choseong.ts`](../src/shared/choseong.ts). Every write to `books` goes through `PostgresMetadataStore.syncBooks` (folder refresh, file add/upload, watcher), which computes it for each row and rewrites it on conflict, so it cannot drift from `filename`. The column is nullable: `ensureSchema()` adds it (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) and then `backfillTitleChoseong()` fills every row where it is `NULL` in batches of 1000, which covers existing records and rows that `ensureSchema` seeds from `book_tags`. A new writer to `books` must set the field too.

The route is part of `createPdfitMetadataRouterMounts`, so the hosted runtime mounts it too. A hosted store answers from the browser's hydrated IndexedDB snapshot instead (`searchCachedBooksByTitle` in `front/cache/metadataCache.ts`, same rules), and `front/api/search.ts` picks whichever exists.

## Bookmark endpoints

`GET /api/bookmarks` returns every persisted bookmark newest-first for the
library route. `GET /api/bookmarks/:folder/:filename` remains the viewer's
book-local query. Both return `BookmarkRecord`; `POST`, `PATCH`, and `DELETE`
remain the capture/edit lifecycle endpoints in
[`src/server/api/bookmarks/index.ts`](../src/server/api/bookmarks/index.ts).

## Thumbnail and task endpoints (local runtime)

Mounted only when `backgroundTasks` is configured.

`GET /api/folders/:name/files/:filename/thumbnail[?v=<mtimeMs>-<size>]`

| Status | Body | Meaning |
| --- | --- | --- |
| `200` | `image/jpeg` | The cover. `Cache-Control: public, max-age=31536000, immutable` when `v` matched the stored thumbnail, `no-cache` otherwise |
| `202` | `{ "state": "queued" }` | Not rendered yet. The request queued it ahead of the periodic backlog; ask again later |
| `404` | `{ "state": "failed" }` | Rendering failed within the last 24 hours |
| `404` | `{ "state": "missing" }` | No such PDF in the library |

`v` is the file's modification time in whole milliseconds and its size, both taken
from the folder or tag listing. A hit by `v` does not touch the library volume.

`GET /api/tasks/status` returns the scheduler state: `intervalMs`, `concurrency`,
`planCount`, `planning`, `nextPlanAt`, `pending`, `active`, one entry per task type
(`planned`, `pending`, `running`, `completedSincePlan`, `failedSincePlan`,
`completedTotal`, `failedTotal`, `lastPlanAt`, `lastPlanDurationMs`, `lastPlanError`,
`recentFailures`), and `details.thumbnail.lastPlan` (`sources`, `ready`, `failed`,
`queued`, `removed`, `complete`). `completed*` counts tasks that settled successfully,
not files that exist; the files on disk are the record of what was produced.
