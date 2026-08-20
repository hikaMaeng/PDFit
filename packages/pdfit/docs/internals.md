# Internals

The PostgreSQL store keeps schema ownership for:

* `reading_progress`
* `tags`
* `book_tags`
* `viewer_state`

The watcher reconciles missing files against tracked metadata and emits SSE notifications for front refreshes.

On startup, an existing legacy `app.db` is imported into PostgreSQL and retained
as a timestamped `.migrated-*` backup. New runtime reads and writes use only
PostgreSQL.

## WebGPU viewer contract

`@pdfgpu/core` is the performance path: PDFium produces a low-resolution preview
and visible detail tiles, its byte-budget cache bounds raster memory, and its
renderer composites the visible frame with WebGPU when available or 2D canvas
otherwise. `front/components/PdfGpuViewer/index.tsx` is the PDFit React adapter;
the controller remains the mutable source of truth outside React.

PDFit does not own a second pdfgpu implementation. Core interaction transitions,
DPI normalization, layout, queueing, and rendering are tested and versioned in
the independent repository. PDFit only retains app-specific session state and
the legacy fallback adapter.

During initial loading the core snapshot exposes `loadPhase`, `loadProgress`,
`loadProgressDeterminate`, `loadedPages`, and `loadPageCount`. The percentage covers document download, document opening, plus
the preview pages needed for the initial viewport; later pages remain lazy and
are not falsely reported as pre-rendered.

The controller snapshot is deliberately immutable-by-reference per emission so
`useSyncExternalStore` can detect each update without copying domain state into
React. The existing PDF.js component is retained only as the initialization
fallback for unsupported or failed PDFium environments.

## Reused viewer window contract

`front/viewer/openViewer.ts` assigns a deterministic named browsing context from the
encoded `(folder, filename)` key. An already registered viewer receives a same-origin
`pdfit-viewer-command`, focuses itself, and acknowledges the command; the sender falls back
to navigating a newly created blank target only when that registry record was stale. The
viewer records the requested page in `front/model/viewerNavigationModel.ts`. `PdfGpuViewer`
applies that value only at `loadPhase === 'ready'`, so a command delivered during loading is
not lost. `PdfListItem` is the sole file-row launcher for both folder and tag pages.

## Cross-window bookmark change contract

## Cross-window message router

`front/model/windowSync.ts` owns the single browser transport. It sends a `{ id, topic, payload }`
envelope through `BroadcastChannel` with `localStorage` fallback, de-duplicates IDs per window,
and routes a matching topic only to its registered lambda. A new sync feature adds a stable topic,
serializable payload, payload guard, and a scoped subscriber; it does not add another window event,
channel, or storage listener.

## Cross-window bookmark change contract

`front/model/bookmarkEvents.ts` is the typed bookmark adapter over the message router. Its
`bookmark.change` payload is `(folder, filename, kind)`. Subscribers validate it: the service
gallery reloads its global list and count, while each viewer reloads only when the target book
matches its route. Every completed create, edit (comment and colors included), or deletion uses
this route from either window. The event intentionally carries no bookmark payload: the PostgreSQL
API remains the shared source of truth.

## Bookmark overlays

`front/components/PdfGpuViewer/index.tsx` keeps the persistent bookmark list in
`front/model/bookmarkModel.ts`; a drag rectangle and edit draft are transient UI
state only. The adapter passes PDF-point absolute rectangles to
`PdfGpuViewerController.projectOverlays()`. PDFGPU normalizes them using each
manifest page's point size and returns projections for visible pages only.
The React overlay is a sibling of the PDFGPU-owned viewport because the core
controller owns and replaces the viewport's child DOM.

Bookmark assets are served from the current sibling `books/bookmarks` directory
with the historical `data/bookmarks` directory as a read-only fallback. New
captures are stored only at the current location.

## Hosted IndexedDB cache

The optional browser cache owns `meta`, `folders`, `pdfs`, `tags`, `pdfTags`,
`bookmarks`, `progress`, `viewerStates`, and `syncState`. A schema-versioned hydration
marker makes subsequent service loads read locally. Cache replacement uses one read-write
transaction so the UI never observes a partially hydrated snapshot.

PDF list projections retain each row's `driveFileId`. Folder navigation places that ID
in the viewer URL, and the viewer chooses `/api/folders/by-id/:driveFileId` for PDF bytes.
The folder/name URL remains a compatibility fallback only when no ID is available. The
hosted adapter can therefore serve repeated PDF Range reads without rebuilding a Drive
snapshot or searching by mutable names.
