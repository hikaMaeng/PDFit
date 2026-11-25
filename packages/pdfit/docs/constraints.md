# Constraints

## Tag folder controls

The shared [sidebar](../src/front/layout/LNB.tsx) consumes the server’s folder order and uses the folder ID for collapsed state. `lnb-tag-folder` identifies each row. The edit and arrow buttons include the folder name in their accessible labels. `lnb-tag-folder-icon` exposes the color for browser verification. [Scenario](testing.md#tag-folder-editing)

* PDFium bitmap output stays in native BGRA order and is converted to RGBA exactly once. Do not combine `FPDF_REVERSE_BYTE_ORDER` with the existing BGRA-to-RGBA conversion because it corrupts red and blue channels in color-heavy PDFs.

* Shared metadata owns book and library data. Store book comments separately from clips and their clip memos.
* Keep shared metadata tables separate from application settings tables.
* Do not let service composition import viewer entry composition directly.
* Do not let viewer composition import service layout, LNB, home, folder, or tag routes.
* Do not let common server bootstrap import app-owned settings storage.
* Keep app composition on `client/service`, `client/viewer`, `client/shared`, `server`, and `server/postgres`.
* Hosted variants must use `createPdfitServer`,
  `createPdfitMetadataRouterMounts`, and `createPdfitRemoteFoldersRouter`.
  Storage, authentication, and billing belong in adapters; HTTP validation and
  API response contracts must not be copied into an app module.
* Consumer: `apps/pdfit` service entrypoint. Invariants: `pdfit.language` wins over browser detection, unsupported or absent browser language resolves to English, and the selector updates the same external model before and after authentication.
* Treat `front/*` as compatibility-only during migration; new app code must not target it.
* IndexedDB is an optional cache, never metadata authority. Its database name is scoped by
  authenticated account, and deleting it triggers remote hydration.
* Local PDFit composition must not enable the hosted IndexedDB metadata adapter.
* Hosted metadata writes use an account-scoped IndexedDB outbox. Progress and viewer-state
  rows coalesce to the latest state; network/5xx failures remain queued, while terminal 4xx
  responses are removed and trigger authoritative cache hydration.
* `PdfGpuViewer` owns the PDFium controller/resource lifecycle; React reads its
  stable external snapshot through `useSyncExternalStore` and must not mirror
  viewer state into `useState`.
* Consumer: the integrated app `client/viewer` entry. Invariants: the viewer keeps
  `/viewer/:folder/:filename`, existing viewer-state payloads, semantic toolbar
  roles, and the legacy fallback path.
* Consumer: the PDF.js and GPU local viewer toolbars. [Document scan](api.md#document-scan) uses one server job per book and shares the runtime's OCR capacity. Browser locators use the named `Scan status` button and dialog, `Scan start page` spinbutton, scan progress bar, and in-flight summary button. The summary opens the named `Pages in progress` dialog, whose list items show only in-flight page numbers. The `Scan status` dialog lists all pages with their saved-text state.
* Both engines expose **Clips** in the **PDF annotation tools** complementary
  landmark. The control's `aria-pressed` reports capture mode and `aria-expanded`
  reports list visibility. The captured rectangle and thumbnail keep their existing format.
  **Collapse tool palette**, **Expand tool palette**, and **Move tool palette**
  belong to the same landmark. **Move clip list** and **Close** belong to the
  clip list landmark. Panel visibility and position leave the PDF viewport width
  and fit zoom intact.
* Consumer: bookmark preview plus folder/tag `PdfListItem` rows. Invariants: a book key is
  exactly `(folder, filename)`; at most one named viewer is reused for that key; an explicit
  bookmark page is delivered as a message rather than by reloading the existing viewer; and
  a command received before PDFGPU is ready remains the adapter's pending initial page.
* Consumer: shared cover cards and My clips. `pdf-cover-clips` opens the book-scoped
  `book-clips-dialog`. Both book and library grids use `bookmark-library-card`
  and `bookmark-preview-dialog`. `clip-text-pane` is the separate OCR dialog.
  The memo editor writes the existing clip comment field on Save.
* Consumer: shared cover cards. Scope the auto-classify button to `pdf-cover-tags`
  and locate Comments and File actions inside `pdf-cover-actions` by accessible name.
  File actions opens a menu. Comments opens a dialog with five complete posts
  per page. Scope each post's edit and delete controls to its article.
  `book-comments-content` scrolls independently of the heading and page controls.
* Consumers: PDF.js and PDFGPU viewers. [FloatingBookComments](../src/front/components/book-comments/BookCommentsDialog.tsx)
  shares the book comments protocol and board with the cover card. Keep the floating
  window within the viewer body and leave the PDF and toolbar interactive.
* PDFit must consume the exact `@pdfgpu/core` version recorded by the active
  release contract from the clean sibling `pdfgpu`
  source tree during the build and must
  not copy or alias `pdfgpu/src` into `packages/pdfit/src`.
* The PDFium WASM asset is supplied by the pdfgpu package's pinned
  `@embedpdf/pdfium` dependency (`2.15.1` since `@pdfgpu/core@0.1.10`); the viewer must not depend on a runtime
  CDN fetch.
* The source commit and tarball SHA-256 in `packages/pdfit/vendor/pdfgpu-build.json`
  must match the installed `@pdfgpu/core` version before build or release.
* `release-contracts/pdfit/v<version>.json` is an immutable release record:
  PDFit `0.3.2` points to exactly `@pdfgpu/core@0.1.9`, source commit
  `249af2298cde015b42383494266943135990558c`, and the recorded artifact digest. A later PDFit release adds a new contract file;
  it never edits the previous one.
* Consumer: `PdfGpuViewer` bookmark adapter. Invariants: bookmark rectangles
  are absolute PDF points at rest, PDFGPU projects only visible pages, and the
  viewer overlay is outside the core-owned viewport DOM.
* Consumer: bookmark library, viewer bookmark bar, and page overlay mutation
actions. Invariants: a completed create, edit (including comment/border/fill color),
or deletion updates its local model and publishes `bookmark.change` with the exact
`(folder, filename, kind)` target; deletion also removes the PostgreSQL row and JPEG asset.
* Consumer: an open service or viewer window while another window mutates bookmarks.
Invariants: subscribers only reload their matching book from the bookmark API after the
same-origin signal; they never treat a cross-window event payload as bookmark truth.
* Consumer: future cross-window features. Invariants: they publish a serializable payload through
`front/model/windowSync.ts`, route by a stable topic, validate their own payload at the topic
boundary, and register only the lambda that owns the affected model/API reload. They must not add
feature-specific transport listeners or duplicate `BroadcastChannel`/`localStorage` plumbing.

* Release `0.4.0` adds `release-contracts/pdfit/v0.4.0.json`; it keeps the exact
  `@pdfgpu/core@0.1.9` source commit and digest from the previous contract.
* Release `0.4.1` adds `release-contracts/pdfit/v0.4.1.json`; it keeps the same
  pinned PDFGPU package, source commit, and artifact digest.
* Release `0.4.2` adds `release-contracts/pdfit/v0.4.2.json`; it keeps the same
pinned PDFGPU package, source commit, and artifact digest.
* Release `0.4.3` adds `release-contracts/pdfit/v0.4.3.json`; it keeps the same
  pinned PDFGPU package, source commit, and artifact digest.
* Release `0.4.4` adds `release-contracts/pdfit/v0.4.4.json`; it keeps the same
  pinned PDFGPU package, source commit, and artifact digest.
* Release `0.4.5` adds `release-contracts/pdfit/v0.4.5.json`; it keeps the
  `@pdfgpu/core@0.1.9-pdfit.1` package, source commit, and artifact digest of
  the updated `v0.4.4` contract.
* Release `0.4.6` adds `release-contracts/pdfit/v0.4.6.json`; it keeps the same
  `@pdfgpu/core@0.1.9-pdfit.1` package, source commit, and artifact digest.
* PDFit `0.4.7` pins core `0.1.11`. PDFit `0.4.8` pins `@pdfgpu/core@0.1.12` for page color adjustments. The exact source commit and artifact digest are in [`release-contracts/pdfit/v0.4.8.json`](../../../release-contracts/pdfit/v0.4.8.json). Since core `0.1.10`, PDFium keeps `FPDF_REVERSE_BYTE_ORDER` and the conversion fills alpha.
* PDFit `0.4.9` pins `@pdfgpu/core@0.1.12-pdfit.1` for [progressive rendering](internals.md#webgpu-viewer-contract). The shared GPU adapter is used by Free and Pro. The [release contract](../../../release-contracts/pdfit/v0.4.9.json) pins the source commit and artifact digest.
* [Viewer color adjustments](../src/front/components/ViewerToolbar/ImageAdjustmentPopover.tsx) use one [session model](../src/front/viewer/sessionModel.ts) for both renderers. WebGPU changes tile RGB once through the core controller. PDF.js and PDFGPU Canvas 2D use the [display filter](../src/front/components/PageColorFilter.tsx). The stored `viewer_state.inverted` flag stays compatible with earlier clients. The other controls are session-only, and the original rasters remain available to clip capture.
* Consumer: `PdfGpuViewer` window key listener. Invariant: since `@pdfgpu/core@0.1.10`
  the core binds the paging keys on its focused viewport and calls `preventDefault`
  when it navigates; PDFit's window listener ignores events that are already
  `defaultPrevented` (and modifier/editable-target keys), so one key press moves one
  page or row.
* Consumer: both viewers' two-page layout. Invariant: spread pairing is a reader choice,
  `paired` (1,2),(3,4)... (default, the pre-0.4.7 PDF.js behaviour) or `alone`
  (1),(2,3),(4,5)..., stored per browser in `localStorage` key
  `pdfit.viewer.spreadCover` and shared by both viewers. Row rules come from
  `@pdfgpu/core` (`normalizeViewerPage(page, count, 'double', pairing)` and the shared
  reducer's `pairing` state, `spreadPairing` / `setSpreadPairing` on the GPU controller);
  `front/viewer/spreadPairing.ts` only derives the visible row, the last row and the
  switch-back memory from them. In `paired`, the core ignores `spreadPlacement`.
* AI automatic tagging sends only the title derived from the filename, the fixed bookstore taxonomy, and existing tag names. Model output is untrusted and restricted to one to three shared taxonomy values. Titles, authors, proper nouns, and arbitrary title tokens must never become generated categories.
* Folder-wide automatic tagging classifies at most three books concurrently, then persists successful relations in one storage batch. It reports classifier failures without discarding successful results. Empty remote-AI configuration falls back to the deterministic shared title classifier; partially configured remote credentials fail at startup.

## Clip mutation IDs

The viewer and clip library support LAN HTTP. Generate browser-side UUID v4 values
with [createBrowserUuid](../src/front/browserUuid.ts#createBrowserUuid), which uses
Web Crypto `getRandomValues` in both HTTP and HTTPS contexts. The
[optimistic clip create](../src/front/model/optimisticBookmarks.ts#createBookmarkOptimistically)
reuses its operation ID for retries, the API payload, and the metadata outbox.
