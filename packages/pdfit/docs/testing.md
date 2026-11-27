# Testing

## Page text popup

Run the [Free browser scenario](../../../apps/pdfit/tests/page-ocr-popup-browser.mjs)
against an isolated runtime with the two fixture books described in the
[test plan](../../../apps/pdfit/tests/plans/page-ocr-popup-20261127.md).
Use the page text dialog’s title, named resize handle and editor, and the
`page-ocr-scroll` anchor to assert overflow. `npm run test:ocr` covers the
saved text revision, cache, and recognition paths.

## Tag folder editing

Run [tag-folders.test.mjs](../tests/tag-folders.test.mjs) against an isolated PostgreSQL database to verify legacy migration, membership preservation, and concurrent moves.
The [Free browser scenario](../../../apps/pdfit/tests/tag-folder-edit-browser.mjs) scopes actions to `lnb-tag-folder`, uses named buttons and the edit dialog, and reads the icon from `lnb-tag-folder-icon`.

Shared package changes are verified through:

* `npm run build`
* `npm run verify:repo`
* `npm run verify:pdfit`
* `npm run test:pdfgpu`
* `npm run test:outline` verifies outline extraction, conditional initialization, deletion, validation and unsupported storage. With `PDFIT_TEST_DATABASE_URL`, it also checks the PostgreSQL row lifecycle.
* [YES24 outline quality](../../../apps/pdfit/tests/plans/viewer-outline-quality-20261120.md) checks both scan-volume PDFs against their YES24 listings and physical PDF pages, including the numeric-cache migration and page navigation.
* [Outline management browser scenarios](../../../apps/pdfit/tests/plans/viewer-outline-management-20261120.md) cover edit and retry, page navigation, deletion across reloads, and PDF.js and PDFGPU regeneration. Open the `Table of contents` toolbar button (`viewer-outline-open`) and use visible actions in its named dialog. `pdf-outline-entry` identifies a listed row and `pdf-outline-edit-row` scopes labels in each editor row.
* [Floating outline and reading position](../../../apps/pdfit/tests/plans/viewer-outline-save-page-20261127.md) checks per-book popup geometry, viewer interaction while open, and immediate reading position persistence and retry. Each linked list item has a button named `Go to page {page} and save reading position`. Scope by the list item’s title when multiple entries share a page.
* [Document scan browser scenario](../../../apps/pdfit/tests/plans/viewer-scan-20261124.md) exercises the shared scheduler, saved-page colors, cancellation, and failure recovery on standalone Docker. The in-flight count appears in the progress bar's accessible name during scanning and in the summary button. The summary opens `Pages in progress`. Synthetic scan snapshots verify the fixed-width summary and live updates in the scrollable grid at 320 px.
* [Tag management browser coverage](../../../apps/pdfit/tests/plans/tag-management-20261123.md) scopes the input and recent-tag group to the named dialog. The popup exposes `listbox` and `option` roles.
* `npm run test:tasks`: background task queue, scheduler (replan, parallelism budget,
  failed plan, urgent submissions, timers), worker pool with real worker threads
  (script error, contract violation, timeout recovery), and the thumbnail job end to
  end with real PDF.js rendering (fresh/stale/orphan/failed thumbnails, offline-library
  guard, HTTP route states), and a hosted-style job on `createPdfitTaskScheduler` that
  renders through authenticated HTTP range reads with the shared script
* `npm run verify:release-contract`
* integrated app build and deploy
* service/viewer manifest checks that confirm dedicated front entries
* `GET /health` returns a JSON `{ ok: true, service }` response for `pdfit`
* repository guards that reject legacy dist references
* PostgreSQL/pgvector extension, shared metadata CRUD, and Settings CRUD checks
  against the deployed integrated container

Viewer-toolbar and export coverage builds the shared front package and opens a
deployed viewer in Chromium with
`apps/pdfit/tests/viewer-toolbar-export-browser.mjs`. It verifies toolbar order,
manual zoom entry, continuous-scroll on/off behavior, momentary fit width,
the select/move cursor, the single PDF download path, and an error-free browser
console. The source PDF must remain unchanged.

Same-account library reconciliation is covered by
`apps/pdfit/tests/same-account-library-sync-browser.mjs` with independent PC
and tablet browser contexts. The Safari download hint, direct user-clicked
attachment link, and filename fallback are covered in Chromium and WebKit with
`apps/pdfit/tests/viewer-toolbar-export-browser.mjs --touch-save-hint`.

Tablet page-mode gestures are covered by
`apps/pdfit/tests/viewer-double-fit-height-browser.mjs --touch-swipe` and
`--horizontal-swipe`, each with and without `--gpu`. The tests verify
one-page/two-page navigation without continuous scroll, fitted touch-action,
and zoomed-page panning before navigation.

Acrobat-compatible zoom coverage runs
`apps/pdfit/tests/pdf-zoom-acrobat-browser.mjs` against the deployed viewer. A
612-by-792-point Letter fixture must render as 816-by-1056 CSS pixels at 100%,
as 1020-by-1320 pixels at 125%, and must still exactly honor fit-width and
fit-height controls.

[Fit stability](../../../apps/pdfit/tests/plans/viewer-fit-stability-20261123.md)
samples each frame around both fit actions at classic scrollbar thresholds. It
also covers active fit during viewport resizing and bookmark sidebar changes.

Folder multi-delete browser coverage selects two uniquely named PDF rows,
checks the selected-count confirmation, deletes them, and verifies both the UI
and file API no longer expose either PDF. It also verifies select-all and
selection clearing without deleting the library's existing files.

[Home introduction coverage](../../../apps/pdfit/tests/plans/home-introduction-20261123.md)
uses the shell's `main` landmark, the named library, AI and reading sections,
and their visible link names. The **라이브러리 열기** href must use the
folder API row marked `isRoot` (or the first folder if no row is marked).
Verify the destination along with the tag index, untagged, favorites, clips,
and AI settings routes. The AI settings link and standalone feature copy
depend on the app registering `/settings`.

The [library browser scenario](../../../apps/pdfit/tests/plans/library-list-mode-20261125.md)
checks the document count and two view buttons in `folder-list-toolbar`. It
checks the absence of book checkboxes in list items and `pdf-cover-card`.
The named AI button in each view submits one request for the book identified by
its filename link. Earlier selection and bulk tagging scenarios predate this change.

`npm run sync:pdfgpu` builds the sibling `@pdfgpu/core`, packs it, verifies its
source commit and SHA-256 manifest, and relinks the local PDFit dependency.
The independent core suite runs in `F:\dev\pdfgpu`; PDFit integration tests then
load the local source package API and app-owned `ViewerSessionModel`.
`verify:release-contract` additionally checks every PDFit package version,
the installed core package version, source specifier, source commit, and
artifact digest as one source contract. The contract is selected from
`release-contracts/pdfit/v<PDFit-version>.json`, so old PDFit-to-pdfgpu mappings
remain auditable after either project advances independently.

GPU viewer browser contract:

* `getByRole('toolbar', { name: 'viewer controls' })`
* `getByRole('status', { name: 'viewer status' })`
* `getByRole('region', { name: 'PDF viewer' })`
* `data-testid="pdfgpu-scroll-area"` and `data-testid="pdfgpu-page-shell"`
* `data-testid="viewer-load-progress"` displays the interpolated loading gauge;
  the PDFGPU source 35% is the PDFit display 100% endpoint.
* `data-testid="bookmark-capture-surface"`, `bookmark-drag-preview`,
  `bookmark-page-overlay`, `bookmark-card`, `bookmark-card-go-to-page`, and `bookmark-editor`

Scope **Clips** to the **PDF annotation tools** complementary landmark. Initially,
capture is off and the list is closed. Clicking **Clips** sets `aria-pressed` and
`aria-expanded` and opens the list. Clicking the active button again cancels it.
Verify a visible drag preview, one successful POST, a card and overlay without
reloading, and an inactive button with the list still open after pointer release.
The list header's **Close** dismisses it. Keep PDFGPU checks for PATCH persistence
through the editor, comment tooltip, and overlay coordinates after zoom.
In both engines, check **Collapse tool palette** and **Expand tool palette** in
**PDF annotation tools**, then move each panel using **Move tool palette** and
**Move clip list**. Use the PDF viewport and rendered page bounds to verify that
opening, moving, collapsing, and closing panels preserve width fit. The PDF.js
viewport uses `pdf-scroll-area`.
Remote-backed viewer verification must cover capture while the page is still in
preview quality and confirm that detail readiness resumes the pending capture.
The F04/F05 acceptance cases explicitly select GPU and PDF.js. Verify the GPU
card's page-jump icon navigates without opening the editor.
The bookmark-library new-window flow must first persist a different viewer page,
then assert that `?page=` wins after the loading indicator disappears. This guards
the shared `goToPage` path against saved-scroll restoration races.
The reused-window flow opens one book from a folder, sends its bookmark page while that
viewer is loading, then activates the same folder and tag rows. It must keep one popup,
finish at the commanded page, and report no browser errors.
The bidirectional bookmark flow creates an isolated bookmark, edits its comment and colors in
a separate viewer page, then asserts the service gallery reflects those values. It deletes from
the service gallery and asserts the matching viewer card disappears, with no navigation or
manual refresh. Create, edit, and deletion all use the same book-targeted signal contract.
The router contract additionally requires one transport owner, topic-based lambda dispatch, message
ID de-duplication, and domain payload validation before an API/model action runs.

Bookmark library browser contract:

* `data-testid="lnb-bookmarks"` navigates to `/bookmarks` between folder and tag navigation.
* `data-testid="bookmark-library-page"` exposes recent and per-book tabs.
* `pdf-cover-clips` opens `book-clips-dialog` with the selected book and the date/page sort buttons.
  Its `data-clip-graphic` identifies the displayed artwork. The accessible
  description gives the exact count in Free.
* `bookmark-library-card` opens the shared detail dialog from either grid.
* `bookmark-preview-dialog` contains the labeled memo editor, Reset and Save actions, and the
  `bookmark-preview-open-viewer` page action. The author's capture, border, and color indicator remain visible above the memo.
* `bookmark-preview-text` opens a separate dialog (`clip-text-pane`) with selectable OCR text.
  [Book clips and memo plan](../../../apps/pdfit/tests/plans/book-clips-memo-20261123.md)
* `book-clip-counts.test.mjs` uses an isolated PostgreSQL schema for the backfill,
  concurrent writes, late book indexing and list queries.
  [Book clip count plan](../../../apps/pdfit/tests/plans/book-clip-counts-20261123.md)
* A file row remains a native link named by its filename; its ordinary click is intercepted by
  the shared viewer launcher, while modifier-click keeps normal browser-link behavior.

The deployed GPU viewer also keeps the composited frame pinned to the scroll
viewport while page content moves underneath it. The scroll-boundary regression
test records this contract in `apps/pdfit/tests/reports/pdfgpu-scroll-stability/`
and captures top/middle browser screenshots under `test/YYYYMMDD/<run>/`.
* `data-testid="pdfgpu-text-layer"` on retained page shells

The performance scenario must load a real PDF, assert page shells and canvas
output, exercise zoom/fit/view-mode controls, and record whether the backend is
`webgpu` or the supported 2D fallback.

Hosted IndexedDB changes require a real browser engine. The service browser fixture uses
mock authentication and a mock Spreadsheet snapshot to verify first hydration, reload
without another request, and reconstruction after database deletion without Google API calls.

Title-based automatic tagging is covered by `npm run test:ai-tags`. The suite verifies filename-to-title derivation, prompt data isolation, fenced JSON handling, tag bounds and de-duplication, and persistence through the shared Express route.

## Viewer Bot

See the [Bot browser contract and fixture coverage](book-bot.md#verification).
