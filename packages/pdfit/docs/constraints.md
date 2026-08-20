# Constraints

* Keep shared metadata limited to tags, reading progress, and viewer state.
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
* Hosted progress/viewer-state debounce is not an outbox: failed requests are not queued
  or retried beyond the browser's normal next state update.
* `PdfGpuViewer` owns the PDFium controller/resource lifecycle; React reads its
  stable external snapshot through `useSyncExternalStore` and must not mirror
  viewer state into `useState`.
* Consumer: the integrated app `client/viewer` entry. Invariants: the viewer keeps
  `/viewer/:folder/:filename`, existing viewer-state payloads, semantic toolbar
  roles, and the legacy fallback path.
* Consumer: bookmark preview plus folder/tag `PdfListItem` rows. Invariants: a book key is
  exactly `(folder, filename)`; at most one named viewer is reused for that key; an explicit
  bookmark page is delivered as a message rather than by reloading the existing viewer; and
  a command received before PDFGPU is ready remains the adapter's pending initial page.
* PDFit must consume the exact `@pdfgpu/core` version recorded by the active
  release contract from the clean sibling `pdfgpu`
  source tree during the build and must
  not copy or alias `pdfgpu/src` into `packages/pdfit/src`.
* The PDFium WASM asset is supplied by the pdfgpu package's pinned
  `@embedpdf/pdfium@2.14.0` dependency; the viewer must not depend on a runtime
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
