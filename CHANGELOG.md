# Changelog

## [0.4.3] - 2026-08-11

PDFit 0.4.3 makes bookmark synchronization bidirectional and establishes a
reusable cross-window message router.

### Added

- A single cross-window transport with message IDs, topic routing, and scoped
  subscriber lambdas for future synchronization features.

### Fixed

- Synchronize bookmark creation, comment/color edits, and deletion between the
  service and matching viewer windows through authoritative API reloads.

### Commit summary since 0.4.2

- `d8d0e40` — sync viewer bookmark changes across windows.
- `c842750` — add routed cross-window sync.

## [0.4.2] - 2026-08-11

PDFit 0.4.2 is a focused bookmark new-window navigation fix.

### Fixed

- Apply an explicit viewer `?page=` request after PDFGPU reaches its ready
  phase through the same page-navigation method used by viewer bookmark cards.
- Prevent a persisted scroll position from overriding an explicitly requested
  bookmark page after document loading completes.

### Commit summary since 0.4.1

- `ad3f469` — fix bookmark new-window page navigation.

## [0.4.1] - 2026-08-11

PDFit 0.4.1 is a focused viewer and bookmark-library usability update.

### Improved

- Keep bookmark-library cards aligned with a fixed 150 px image frame and
  three ordered information rows for title/page, creation time, and comment.
- Toggle the viewer toolbar by clicking the center cell of a 3×3 screen grid,
  while preserving bookmark-capture interactions and the Space shortcut.

### Commit summary since 0.4.0

- `96809d7` — fix the bookmark card three-row layout.
- `64cd071` — add the center-grid viewer toolbar toggle.

## [0.4.0] - 2026-08-11

PDFit 0.4.0 adds the complete visual bookmark workflow: capture a high-resolution
region from a page, preserve its absolute PDF coordinates, render it as a live
zoom/scroll/two-page overlay, and manage the saved capture from every viewer and
library surface.

### Highlight — visual bookmarks

- Drag a rectangle in the WebGPU viewer to capture the page region as a JPEG
  (90% quality) with book, page, absolute rectangle, border/fill colors,
  opacity, and comment metadata.
- Show bookmark overlays only for visible pages while PDFGPU recalculates their
  screen projection after zoom, scrolling, page changes, continuous scrolling,
  and two-page layout changes.
- Add recent and book-grouped bookmark galleries with original-capture preview,
  page navigation, color indicator, comment display, and editing.
- Delete from the library card, preview modal, viewer overlay, or viewer
  bookmark-bar card. Deletion removes both PostgreSQL metadata and the stored
  capture asset.
- Keep high-resolution capture non-blocking with a compact loading snackbar when
  detail rendering is not ready.

### Commit summary since 0.3.2

- `b741169` — interpolate the viewer loading gauge to its 100% display endpoint.
- `40c6513` — add preview-modal trash deletion and capture-file cleanup.
- `ea1b0f0` — add the bookmark library card trash action.
- `34dd640` — add viewer overlay and viewer bookmark-bar trash actions with
  alpha `0.4` controls and browser evidence.

### Installation and deployment

- Install the released launcher directly from GitHub with
  `npm install https://github.com/hikaMaeng/PDFit.git#v0.4.0`, then run
  `npx pdfit`.
- Source checkouts use `npm install`, `npm run build`, and the single
  `npm run deploy` Docker entrypoint.
- The release pins `@pdfgpu/core@0.1.9` and runs as one healthy Docker service
  on port `15201`.

## [0.3.0] - 2026-08-07

PDFit 0.3.0 consolidates the integrated PDF library, reader, metadata, and Docker runtime into a stable feature set.

### Added

- Custom colors for tags with ten built-in color choices.
- Instant tag color persistence in PostgreSQL.
- Synchronized tag colors across the sidebar icon, selected-tag highlight, tag-page header, PDF tag capsules, and tag-management dialog.
- Folder and tag navigation with book counts, drag-and-drop tagging, tag management, file moving, deletion, and refresh controls.

### Improved

- Integrated folder library and tag pages render the complete PDF list with responsive mobile behavior.
- First paint keeps heavy PDF viewer code off the initial critical path.
- PDFGPU/WebGPU viewer integration includes browser fallback, persisted reading state, scroll/view modes, inversion, and smoother loading progress.
- Explicit refresh keeps external-library indexing additive and preserves existing metadata.
- Unified Free/Pro application architecture, Settings surface, PostgreSQL metadata, pgvector, and Korean text-search runtime.

### Deployment

- One Docker Compose service on port `15201`.
- Release contract pins `@pdfgpu/core@0.1.5`.
- Verified with repository/build/release-contract checks and Docker health verification.
