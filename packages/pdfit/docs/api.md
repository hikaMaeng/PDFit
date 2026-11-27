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

The shared tags router in [`src/server/routes/tags.ts`](../src/server/routes/tags.ts) keeps `/api/tags` as the string-list compatibility endpoint. `GET /api/tags/summary` returns `{ name, color, bookCount }`. The Free store also returns a stable string `id` and an `icon` key. `DELETE /api/tags/:tag` removes the tag and its `book_tags` links through the database cascade.

`PATCH /api/tags/:id/details` requires `previousName` and one or more of `name`, `color`, `icon`. It returns the stored `{ name, color, icon }`. New names are trimmed, limited to 200 UTF-16 units, and compared using the same exact matching as manual tags. Colors are `#RRGGBB` and icon keys come from [`TAG_ICONS`](../src/shared/tagDetails.ts). It returns 400 for invalid input, 404 for a missing ID, 409 for an existing destination name, 412 when the original name changed, and 501 when the store does not implement tag editing. `PATCH /api/tags/:tag/color` still supports older callers.

`GET /api/tags/index` returns `TagIndexEntry[]` (`{ name, color, icon?, books: [{ folder, filename }] }`) for every tag that has at least one book, from the optional `MetadataStore.listTagIndex()` (answers `501` otherwise). The PostgreSQL implementation reads tags, `book_tags` and `books` in one query with the same rule as `listBooksByTag` (a link whose `books` row is gone is not counted), so a card's book count equals the sidebar `bookCount` and the `GET /api/tags/:tag/books` length. It is a single segment on purpose: a real tag named `index` is still read through `GET /api/tags/:tag/books`. The hydrated browser cache (`listCachedTagIndex`) computes the same grouping locally for the hosted runtime.

`GET /api/tags/untagged-books` returns the books with no `book_tags` row (`TaggedBookRecord[]`, `tags: []`) and `GET /api/tags/untagged-count` returns `{ count }`; both come from the optional `MetadataStore.listUntaggedBooks()` / `countUntaggedBooks()` and answer `501` for stores that do not implement them. The paths are single segments on purpose: a real tag named `untagged-books` is still read through `GET /api/tags/:tag/books`. The hydrated browser cache (`listCachedUntaggedBooks`) computes the same set locally, so the hosted runtime needs no server route.

`POST /api/tags/book/:folder/:filename/auto` derives the book title from the PDF filename, selects one bookstore category plus up to five subject tags (4 to 6 with an AI server; one category from the rule-based classifiers), persists only new normalized tags, and returns `title`, `suggestedTags` (category first), `addedTags` and `removedTags` (old controlled categories). A configured OpenAI-compatible endpoint supplies the tags; its first tag must come from the shared bookstore taxonomy, and subject tags reuse matching library tag names. Without one, the shared zero-configuration category classifier is used so local and hosted Docker runtimes remain functional.

`POST /api/tags/folder/:folder/auto` accepts 1-500 `{ filename, driveFileId? }` book references, classifies them with concurrency limited to three, and persists all successful tag relations through one metadata batch when the storage adapter supports it. The response includes processed/failed counts, the total number of added tags, per-book results (`assignedTag` is the category, `assignedTags` every applied tag, category first), and per-book classifier errors.

## Title search endpoint

`GET /api/search/books?q=<text>[&limit=<n>]` ([`src/server/routes/search.ts`](../src/server/routes/search.ts)) searches book titles in the metadata database, not the file system. The `books` table is the one `syncBooks` keeps in step with the library, so a PDF that is not indexed yet is not found until the next refresh.

* Scope: the title only, i.e. the filename without `.pdf`. Folder names and tags are not searched.
* Match: one substring of the trimmed query, case-insensitive. Both sides are normalized to NFC so a macOS-style NFD filename matches an NFC query. The query is compared with `position()`, so `%` and `_` are literal characters.
* Initials: `books.title_choseong` holds the title with every Hangul syllable replaced by its initial consonant, whitespace removed and the rest lowercased (`이것이 자바다.pdf` → `ㅇㄱㅇㅈㅂㄷ`, `Do it!SQL 입문.pdf` → `doit!sqlㅇㅁ`). A book matches when the query is a substring of the title **or** of this field. The query is compared with that field after lowercasing and removing whitespace but without converting syllables, so `ㅈㅂ` finds `자바` and `정보`, while `자바` does not match `정보`.
* `q` is required and at most 200 characters; otherwise `400`. A metadata store without `searchBooksByTitle` answers `501`.
* Response: `{ query, total, books }`. `books` are `{ folder, filename, size, modified_at, tags }` ordered by filename then folder and capped at `limit` (default 500, at most 2000); `total` is the uncapped match count.

`title_choseong` is derived by `titleChoseong()` in [`src/shared/choseong.ts`](../src/shared/choseong.ts). Every write to `books` goes through `PostgresMetadataStore.syncBooks` (folder refresh, file add/upload, watcher), which computes it for each row and rewrites it on conflict, so it cannot drift from `filename`. The column is nullable: `ensureSchema()` adds it (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) and then `backfillTitleChoseong()` fills every row where it is `NULL` in batches of 1000, which covers existing records and rows that `ensureSchema` seeds from `book_tags`. A new writer to `books` must set the field too.

The route is part of `createPdfitMetadataRouterMounts`, so the hosted runtime mounts it too. A hosted store answers from the browser's hydrated IndexedDB snapshot instead (`searchCachedBooksByTitle` in `front/cache/metadataCache.ts`, same rules), and `front/api/search.ts` picks whichever exists.

`GET /api/search/content/:scope?q=&limit=` queries a single scope described in [Content search and indexes](content-search.md). It accepts the same query length as title search, with an optional integer limit from 1 to 100. The response contains `hits` (id, folder, filename, nullable 1-based page and snippet) and `hasMore`. Invalid input returns `400`; a store without a content index returns `501`. Responses use `Cache-Control: no-store`.

## Table of contents endpoints

[`/api/outlines/:folder/:filename[?driveFileId=]`](../src/server/routes/outlines.ts#createOutlinesRouter) keeps embedded or edited outlines. The wire types and validation are in [`src/common/protocol/outlines/index.ts`](../src/common/protocol/outlines/index.ts).

* `BookOutlineEntry` has `key`, `title`, `depth` and `page`. Keys are unique within the outline. Depth starts at 0. Pages start at 1 and can be `null` for entries without a destination. The limits are 5000 rows, 32 levels and 1000 UTF-16 units per title.
* `GET` returns `{ entries }`, including `[]` after deletion. It returns `404` when there is no current saved outline.
* `PUT` replaces the outline and returns `{ ok: true }`. Empty or invalid entries return `400`. `PUT` with `If-None-Match: *` initializes the stored outline and returns `412` when a current copy or deletion already exists.
* `DELETE` records an empty outline and returns `204`. The marker prevents automatic restoration when opening the dialog.
* Stores without the corresponding optional metadata method return `501`. If `GET` returns `501`, the viewer reads the PDF and hides the persistent edit and delete controls.
* `GET /api/outlines/:folder/:filename/yes24[?isbn=]` returns `{ title, contents }` with one entry per line. It uses the official YES24 public catalog, requires an exact ISBN when supplied or an exact title match, and returns `404` for an unmatched book or an absent listing and `502` for a lookup failure.

PostgreSQL table `book_outlines` (created by `ensureSchema()`): key `(folder, filename)`, one row per book, `entries JSONB`, and `source_size` / `source_modified_at` copied from the book's `books` row when stored. `getBookOutline` returns the row only while those two still equal the `books` row (`IS NOT DISTINCT FROM`), so a replaced PDF is read again and its next successful read overwrites the row. `purgeFile` and `purgeFolder` delete the rows; the folders router's move calls `purgeFile` on the old location. The route is mounted by `createPdfitMetadataRouterMounts`.

[`readPdfOutline`](../src/front/viewer/pdfOutline.ts#readPdfOutline) prefers navigable embedded bookmarks. [`readBookstoreOutline`](../src/front/viewer/bookstoreOutline.ts#readBookstoreOutline) reads YES24 titles and hierarchy, and pairs them with PDF page labels, repeated printed-page offsets, or matched body headings. It extracts text for up to 600 pages plus ISBN candidate pages. Unverified destinations are `null`. PDFGPU uses the same reader through [`readPdfOutlineFromUrl`](../src/front/viewer/readPdfOutlineFromUrl.ts#readPdfOutlineFromUrl).

[`OutlineModel`](../src/front/viewer/outlineModel.ts#OutlineModel) owns dialog operations for both engines. [`loadOutlineWithStorage`](../src/front/viewer/storedOutline.ts#loadOutlineWithStorage) initializes an outline that has at least one destination and reads back current storage on `412`. PostgreSQL treats automatically generated sequences of numeric top-level placeholders as missing. Existing copies with unknown provenance are kept until explicit regeneration. Normal `PUT` writes record a manual edit, and an explicit regeneration sends `generated: true`.

## Book file actions and comments

- `PATCH /api/folders/files/rename` takes `{folder, filename, newName, driveFileId?}` and returns the renamed file metadata. It rejects invalid PDF names with `400` and existing destination names with `409`. The Free store relocates path-keyed metadata in one transaction. [Rename protocol](../src/common/protocol/file-rename/index.ts)
- `GET /api/book-comments?folder=…&filename=…&page=1` returns `{comments, page, total}` with up to five full posts in descending creation order. `total` counts posts. A request past the end returns the last page. `POST` and `PATCH` use the same book query plus a UUID `id` and a JSON `{body}` of up to 10,000 characters. The body must contain non-whitespace text. The API preserves its whitespace for Markdown. `DELETE` also uses the book and post ID. Posts follow the PDF through file rename and folder moves. [Comment protocol](../src/common/protocol/book-comments/index.ts)

## Bookmark endpoints

`GET /api/bookmarks` lists persisted clips for **My clips**. The viewer and book
card dialog use `GET /api/bookmarks/:folder/:filename`. Both return
`BookmarkRecord[]`. The detail editor sends `PATCH /api/bookmarks/:id` with
`comment` as a string or `null` to clear it. A memo update leaves the capture,
creation time, and OCR fields intact.
See [the bookmark routes](../src/server/api/bookmarks/index.ts#createBookmarksRouter).

Free folder files, title search, tagged, untagged and favorite book records
include `clipCount` and `clipCountRevision` from the book row. Clip creation
can return the new values in `bookClipCount`. Deletion preserves HTTP 204 and
sends the values in `X-PDFit-Clip-Count` and `X-PDFit-Clip-Count-Revision` when
the book is indexed. [Count storage](internals.md#book-clip-counts)

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

A real-book cover the user chose (below) replaces the rendered page in this response.
The client then adds `c=<version>`: with `c` equal to the stored version the response
is `immutable`, without it `no-cache`. The type follows the stored image
(`image/jpeg`, `image/png` or `image/webp`).

## Real-book cover endpoints (local runtime)

Mounted with the thumbnail routes (`backgroundTasks`). Images are stored under
`<thumbnailRoot>/covers` as `<sha1(folder NUL filename)>.<version>.<ext>` plus a
`<hash>.json` record. They do not depend on the PDF's modification stamp. Deleting or
moving the file through the folders API deletes or moves its cover.

| Method and path | Body or query | Result |
| --- | --- | --- |
| `GET /api/covers` | | `{ overrides: [{ folder, filename, version, source, title }] }` |
| `GET /api/covers/candidates` | `q` (1-200 chars), optional `source` (`YES24` or `Open Library`) | `{ candidates: [{ source, title, authors?, imageUrl, pageUrl, score }], failedSources }`, best `scoreBookTitleMatch` first |
| `GET /api/covers/preview` | `url` | The candidate image through the server |
| `PUT /api/covers` | `{ folder, filename, imageUrl, source, title, pageUrl? }` | Downloads and applies; `{ folder, filename, version, source, title }`; emits `covers-changed` (not `folders-changed`) |
| `DELETE /api/covers` | `folder`, `filename` | `{ removed }`; the rendered first page returns; emits `covers-changed` |

[`GET /api/covers/candidates`](../src/server/routes/covers.ts) cancels the external lookup when the client disconnects. A completed lookup still reports unavailable sources in `failedSources`. The [cover dialog](../src/front/components/RealCoverDialog.tsx) uses a separate request for each source and cancels any pending search when the user selects a candidate or closes the dialog.

Sources are the public YES24 book search (`image.yes24.com/goods/<id>/XL`) and Open
Library `search.json` (`covers.openlibrary.org/b/id/<id>-L.jpg`). A source that fails
is listed in `failedSources` and does not hide the other. Images are downloaded only
over HTTPS from `image.yes24.com`, `covers.openlibrary.org`, `archive.org` and
`*.us.archive.org`. Redirects are followed by hand and each hop is checked against the
same list. The body must be a JPEG, PNG or WebP by its leading bytes, between 1 KB and
8 MB. No AI model is involved: the user picks the candidate.

The dialog asks each site in its own request (`source=`): YES24 answers in about 0.3 s and
Open Library in seconds, so results show as each arrives instead of after the slowest.
Without `source` both sites are asked and the call waits for both.

`covers-changed` goes over `/api/events`. The sidebar answers it by reloading only
`GET /api/covers`; a cover change is not a library change, so folder and file lists are not
reloaded. In the browser a card subscribes with `coverStateKey(folder, filename)`, so a
replaced cover re-renders that one card; subscribing every card to one global revision
re-rendered all 715 cards of a library (about 3.7 s of frozen page).

`PUT` decides that the file exists from the metadata index (`hasFile`, wired to
`listBooksByFolder` in `createCommonRouters`), never from a synchronous disk read: an
unreachable library volume (SMB `Host is down`) must neither block the server nor turn
a known file into `404 File not found.` Only a file the index does not hold returns 404.
A previewed candidate image is staged by `coverImageCache` as a file under
`<thumbnailRoot>/covers-staging/<sha1(url)>.<jpg|png|webp>` (1 hour, 200 images, 128 MB,
oldest dropped first, pruned after each download and at start; concurrent previews share
one download). Applying a candidate reads the staged file instead of downloading again,
also after a restart. Without a staging directory the images are kept in memory instead.

## Book Bot

See the [session and turn API](book-bot.md#api).

## AI model requests

The shared [AI completion transport](../src/server/services/aiModelRequest.ts#streamAiCompletion) requests `stream: true` for Bot answers, evidence summaries, clip descriptions, visual OCR, display translation, and model-based tagging. It collects only answer content from SSE. The server validates the completed output before writing OCR, tags, or a chat turn. Translation and the OCR and tagging APIs continue returning their structured results. Compatible providers that return a single JSON body still work. A stream without a completion marker or finish reason is treated as incomplete.

Every model call goes through the [completion queue](../src/server/services/aiModelRequest.ts#streamAiCompletion). Each upstream endpoint shares one pool across its models and features, sized by **Concurrent AI requests** in Free Settings. The legacy Settings field remains `ocrConcurrency`. When multiple Settings entries share an endpoint, the smallest configured limit applies. An environment-only endpoint defaults to one worker. Bot and automatic tagging have highest priority, explicit page OCR follows, and scans, clip OCR, and passive display translation use background priority. Equal-priority requests start in enqueue order. Each worker holds its slot through the end of the model response.

The [20-minute model deadline](../src/server/services/aiModelRequest.ts#AI_MODEL_REQUEST_TIMEOUT_MS) starts when a worker takes the request. A Bot turn shares that duration across its upstream model calls and charges only execution time. The [Free transport](../../../apps/pdfit/src/server/services/aiModelFetch.ts#fetchAiModel) permits 20 minutes for response headers or an idle response body.

With `Accept: application/vnd.pdfit.ai-progress+event-stream`, page OCR, automatic tagging and display translation emit SSE [progress frames](../src/common/protocol/ai-model/index.ts) on model queue wait and inference start. A terminal `result` includes the original JSON body and its HTTP status. Bulk tagging identifies the item by its zero-based index after deduplication. Requests that never reach a model and callers using the default response format receive JSON as before. For Bot, see its [progress protocol](book-bot.md#api). Pending clip records expose `ocr.modelPhase`, and document scan jobs report `modelPages` keyed by 1-based PDF page.

## OCR (local runtime)

Mounted with the thumbnail routes (`backgroundTasks`). Text is read in two steps:

1. **PDF text layer** (`source: "text-layer"`). A `page-text` task in the shared worker
   pool reads the page with PDF.js. For a clip, only items whose centre lies inside
   the clip rectangle count; the rectangle is the bookmark's `rect`, in PDF points with a
   top-left origin. Items become lines when the baseline moves by more than half their
   height or the item ends a line. A gap over 15% of the height becomes a space.
   The task also reports `textLayer`: `visible` (digital text) or `hidden` (the page
   draws its text invisibly, rendering mode 3: an OCR layer someone put over a scan).
   A hidden layer is checked for OCR damage (`server/ocr/textLayerQuality.ts`): runs of
   split Latin words ("pr i ntf"), CJK ideographs, stand-alone jamo, "댜", full-width
   marks, weighted per 100 characters; at or above `HIDDEN_LAYER_GARBLE_LIMIT` (1.0) the
   layer is `untrusted`. A visible layer is always trusted.
2. **Vision model** (`source: "vision"`), when step 1 found no non-blank character
   (scanned pages) or only an untrusted hidden layer. The same task renders the area
   from the PDF: 1600 px wide for a page or a clip, at most 4x the PDF size (a
   column-wide clip reaches about 1600 px; its screen capture is used only if no
   rendering exists). Without a vision server an untrusted layer's text is returned
   as `text-layer` rather than nothing. The model comes from
   `backgroundTasks.resolveVisionServer()`, called on every use. The Free app picks the
   first Settings server with a `vision` model, else the first with an `llm` model,
   with a 300 s limit. Vision requests run one at a time.

`GET /api/ocr/page?folder=…&filename=…&pageIndex=…` reads the saved result for
the current file stamp. It returns the same result shape as POST with
`cached: true`, or `204` when the cache has no result. It sends
`Cache-Control: no-store` so a later lookup sees a completed scan. Lookups
only read the cache and leave PDF workers, the vision model, and the search index idle.
See [the OCR route](../src/server/routes/ocr.ts).

`POST /api/ocr/page` `{ folder, filename, pageIndex }` (0-based) returns
`{ text, source, cached, pageIndex, pageCount, durationMs }`. `source` is `none` when
the page has no text layer and no vision model is configured. Errors: `400` invalid
body or page out of range, `404` file not found, `502` task or model failure.
Results are cached in `<ocrCacheRoot>/<sha1(folder NUL filename)>.v2-<mtimeMs-size>.p<index>.json`
(`v2`: results made before the hidden-layer check are not served and are deleted on the next save),
by default `ocr` beside `thumbnailRoot` (`/app/data/ocr`). Saving a result deletes that
file's results for older stamps. Results for deleted files are not collected. `none`
is not cached, so configuring a vision model applies to the next request. A waiting
request is re-planned by every periodic plan and gives up after 10 minutes.

For an explicit scan, the [front-end client](../src/front/api/ocr.ts) separates a failure the server reported from one
it never saw: a fetch that threw, or a `502`/`503`/`504` whose body is not this API's JSON,
is a gateway or a restarting runtime answering, and is retried after 1, 2, 4, 8 and 15
seconds (about 30 s in all) before `OcrUnreachableError` reaches the caller. A JSON error
from the runtime is not retried.

### Document scan

The [OCR router](../src/server/routes/ocr.ts) registers these endpoints when the local store supports page OCR lookups. They identify the book by `folder` and `filename`.

| Request | Result |
| --- | --- |
| `POST /api/ocr/scan` with book and 1-based `startPage` | `202 { job }`. A second start for an active document returns its existing job. |
| `GET /api/ocr/scan?folder=…&filename=…` | `{ job }` with the active or recent job, or `null` when absent. |
| `POST /api/ocr/scan/cancel` with book and job `id` | `{ job }`. Only a matching running job enters cancellation. |
| `GET /api/ocr/scan/pages?folder=…&filename=…` | `{ pages }` with zero-based indexes of pages whose text matches the current PDF's metadata stamp. |

The [PDFit dispatcher](../src/server/ocr/ocrScan.ts#createOcrScan) admits pages up to the selected AI server's limit across all documents. Each completed page releases one admission. The next page comes from the ready document with the fewest pages in flight, with rotation for ties. PDF worker tasks extract the text layer or render a page before the [completion queue](../src/server/services/aiModelRequest.ts#streamAiCompletion) takes over vision inference. A single [scan result listener](../src/server/ocr/ocrService.ts#createOcrService) saves results from all documents in receipt order.

Job snapshots expose `id`, `status`, `startPage`, `pageCount`, 1-based `activePages`, and `processedPages` (including skipped DB hits). The worker determines the page count. The first error records `failure` and `failedPage` and stops new dispatch for that document. `stopping` or `cancelling` indicates that admitted work is draining before `failed` or `cancelled`. Jobs and progress are in process memory. Text is committed page by page to PostgreSQL and survives a restart.

For Free, `docker logs --timestamps pdfit-pdfit-1` includes `[ocr] scan` JSON records from the [dispatcher](../src/server/ocr/ocrScan.ts) and [vision request queue](../src/server/ocr/visionOcr.ts). Filter by the `jobId` from the scan API to follow dispatch, page stages, cancellation, and the terminal result. `work.failed` with `stopsDispatch: true` marks the first error. Later failures belong to work already admitted. The page phases distinguish PDF worker wait, vision queue wait, the upstream request before response headers, response parsing, and cache or index persistence. The vision dispatch records the endpoint origin, model, timeout, and queue occupancy. Logs exclude request and response bodies and configured headers. Save incident logs before recreating the container.

Clip bookmarks (`POST /api/bookmarks/:folder/:filename`, local files only) are queued
after the clip is saved. The `201` response carries `ocr.status: "pending"`. When
OCR finishes, `ocr` is `{ status, text, source, error, updatedAt }` (`updatedAt` ISO 8601):

| `status` | Meaning |
| --- | --- |
| `pending` | Queued. A restart leaves it pending and the next plan queues it again |
| `done` | `text` holds the clip text; `source` says which step read it |
| `unavailable` | No text layer and no vision model configured |
| `failed` | `error` holds the reason (task error, model HTTP status, timeout) |

`failed` and `unavailable` are not retried on their own. `POST /api/bookmarks/:id/ocr`
queues the clip again (`202`; `404` unknown id or the PDF is no longer local; `501` where the
store has no OCR methods). Finishing emits the `bookmarks-changed` server event. OCR state is stored in
`bookmarks.ocr_status`, `ocr_text`, `ocr_source`, `ocr_error` and `ocr_updated_at`; writing
it does not change `updated_at`, which tracks user edits. The `MetadataStore` methods are
optional (`getBookmark`, `listBookmarksWithOcrStatus`, `setBookmarkOcr`). A store without
them saves clips without OCR.

`GET /api/tasks/status` returns the scheduler state: `intervalMs`, `concurrency`,
`planCount`, `planning`, `nextPlanAt`, `pending`, `active`, one entry per task type
(`planned`, `pending`, `running`, `completedSincePlan`, `failedSincePlan`,
`completedTotal`, `failedTotal`, `lastPlanAt`, `lastPlanDurationMs`, `lastPlanError`,
`recentFailures`), and `details.thumbnail.lastPlan` (`sources`, `ready`, `failed`,
`queued`, `removed`, `complete`). `completed*` counts tasks that settled successfully,
not files that exist; the files on disk are the record of what was produced.
