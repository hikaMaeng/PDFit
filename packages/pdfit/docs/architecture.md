# Architecture

`packages/pdfit/src` is split by runtime first and by feature second.

| Path | Contract | Drill-down |
| --- | --- | --- |
| `src/client` | Browser entry factories and runtime-safe UI composition. | `src/client/entries/service/index.ts#createPdfitServiceApp` |
| `src/front` | Shared library pages, viewer, and PDFGPU implementation. | `src/front/pages/PdfViewerPage.tsx` |
| `src/front/model/windowSync.ts` | Shared cross-window transport, message envelope, and topic router. | `src/front/model/windowSync.ts#subscribeWindowSyncMessage` |
| `src/front/model/languagePreference.ts` | Shared browser-language detection, persisted preference, document direction, and external-store model. | `src/front/model/languagePreference.ts#pdfitLanguagePreferenceModel` |
| `src/server` | Express route factories, filesystem services, and PostgreSQL adapter. | `src/server/bootstrap/index.ts#createPdfitServer` |
| `src/server/routes/remoteFolders.ts` | Shared remote-storage folder/file HTTP contract. | `createPdfitRemoteFoldersRouter` |
| `src/shared` | Runtime-neutral metadata and application types. | `src/shared/index.ts` |

Client:

* `client/shared`: runtime config bridge, theme, and entry-safe shared types
* `client/service/common`: service-only routes and layout composition
* `client/viewer/common`: dedicated viewer routes
* `client/entries/service`: `createPdfitServiceApp`
* `client/entries/viewer`: `createPdfitViewerApp`
* `front/components/PdfGpuViewer`: WebGPU/PDFium viewer adapter used by the shared viewer page
* `front/viewer/openViewer.ts`: one named window per book, same-origin page-command handshake,
  and stale-window fallback used by bookmark, folder, and tag opening actions
* `front/pages/BookmarkPage.tsx`: global bookmark gallery with recent and per-book projections
* `@pdfgpu/core`: independently versioned PDFium/WebGPU engine, bounded raster queue,
  byte-budget cache, WebGPU/2D compositor, and initial viewport load progress.
  PDFit consumes the clean sibling source package during the local build; no
  GitHub Release asset is required for this patch.

Server:

* `server/api/*`: folders, tags, progress, viewer-state, events router factories
* `server/bootstrap/*`: common router assembly and `createPdfitServer(options)`
* `server/postgres`: shared PostgreSQL metadata store
* `server/routes/metadataStoreResolver.ts`: request-scoped account adapter for the same metadata routers

Contracts:

* service entry does not register viewer routes
* viewer entry does not import service layout or service page composition
* common server bootstrap mounts common API first and app-owned routers second
* `front/*` remains a compatibility layer during migration; app composition must use `client/*`

Viewer render path:

`client/viewer/common/App.tsx` -> `front/pages/PdfViewerPage.tsx` -> `front/components/PdfGpuViewer/index.tsx` -> `@pdfgpu/core`.
The legacy `front/components/PdfViewer` remains the explicit fallback when PDFium WASM cannot initialize.

Viewer reuse path:

`BookmarkPage` or `PdfListItem` -> `front/viewer/openViewer.ts#openViewer` -> named
viewer window -> `PdfViewerPage` message receiver -> `viewerNavigationModel` -> viewer
adapter `initialPage`. `PdfListItem` is shared by folder and tag pages, so both use the
same per-book reuse contract.

Cross-window bookmark change path:

`PdfViewerPage` or `BookmarkPage` create/update/delete ->
`front/model/bookmarkEvents.ts#publishBookmarkChange` with `(folder, filename, kind)` ->
`front/model/windowSync.ts#publishWindowSyncMessage` envelope -> local router plus
`BroadcastChannel`/`localStorage` transport -> topic subscribers -> service gallery/LNB and matching
viewer authoritative bookmark API reload.

Bookmark library path:

`front/layout/LNB.tsx` -> `front/pages/BookmarkPage.tsx` ->
`front/api/bookmarks.ts#listAllBookmarks` -> `server/api/bookmarks/index.ts` ->
`MetadataStore.listAllBookmarks`. `bookmarkLibraryModel` is the browser-side
list truth; capture/edit events refresh it through the `bookmark.change` router topic.

## Independent pdfgpu integration

`npm run build` and `npm run sync:pdfgpu` resolve the sibling repository from
`PDFGPU_SOURCE_DIR` or the default `F:\dev\pdfgpu`. The sync step requires a clean
pdfgpu working tree, builds `@pdfgpu/core`, packs it, computes SHA-256, and writes
the source commit/version to `packages/pdfit/vendor/pdfgpu-build.json`. Set
`PDFGPU_REFRESH=0` only when consuming the already pinned source manifest; use
`PDFGPU_ALLOW_DIRTY=1` only for local investigation, never for a commit.
