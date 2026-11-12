# Changelog

## [Unreleased]

## [0.4.7] - 2026-11-12

PDFit 0.4.7 moves the viewer core to `@pdfgpu/core` 0.1.10 (PDFium 2.15.1, PDFium
rasterized in a pool of Web Workers, GPU device-loss recovery, visible-page and
spread-landing fixes, keyboard paging bound by the core) and lets the reader choose
the two-page pairing in the PDF.js viewer.

### Added

- **표지 따로 보기** in the PDF.js viewer's two-page layout: the reader switches at any
  time between (1,2), (3,4), ... (default, as before) and the cover alone followed by
  (2,3), (4,5), ... The current page stays in view and the choice is remembered in the
  browser (`localStorage` key `pdfit.viewer.spreadCover`). The GPU viewer keeps the
  core's cover-alone layout.

### Changed

- `@pdfgpu/core` is pinned to the upstream `0.1.10` release (tag `v0.1.10`, commit
  `c72558d`) through `release-contracts/pdfit/v0.4.7.json`. The local
  `0.1.9-pdfit.1` colour patch is gone: 0.1.10 fixes the same red/blue swap upstream.
- The PDF.js viewer's previous/next buttons carry accessible names.

### Fixed

- PDF.js two-page view with 0.1.10: page moves were normalized by the core's
  cover-alone rule while the view drew (1,2) pairs, so (1,2) was followed by (2,3).
  Rows now come from the reader's pairing.
- GPU viewer: with the viewport focused, one PageDown moved two pages, because the core
  now handles paging keys itself and PDFit's window listener handled the same event
  again. PDFit skips events the core already consumed.
- GPU viewer: a page turned while previews were still loading snapped back to the saved
  page when loading finished. A turn made before the saved page is applied now wins.
- Display-name translation waits up to 300 s for a reply instead of aborting after 20 s,
  so a local reasoning model can answer.

- The cover card's info overlay always showed "Last page: —". It read the `reading_progress`
  record, which the viewer never writes, instead of the page the viewer saves in its viewer
  state (the value reopening a book restores). The overlay now reads the viewer state page.

- Opening the app from an address that carries HTTP Basic credentials (`https://user:pass@host/`)
  left the sidebar without folders and tags. The page keeps the credentials in
  `document.baseURI`, so every relative `fetch('/api/...')` resolved to a URL with credentials,
  which `fetch` rejects before sending anything. The service and viewer entries now declare the
  same address without credentials as the document base (`ensureCredentialFreeBase`); the
  browser keeps authenticating from its own HTTP auth cache. Addresses without credentials are
  unchanged.

## [0.4.6] - 2026-11-11

PDFit 0.4.6 adds book-title search (including Korean initials), an "Untagged" entry and a
tag "Index" page to the sidebar, server-rendered cover thumbnails on a shared background
task layer, and a redesigned cover card. It also fixes the viewer's first wheel after
reopening a book.

### Added

- A fixed search box under the sidebar header. Submitting opens `/search?q=`, a read-only
  results page (list or cover view). It searches book titles only (the filename without
  `.pdf`) as a case-insensitive substring with NFC normalization, and reads the metadata
  database instead of the file system: `GET /api/search/books?q=` queries the PostgreSQL
  `books` table, and the hosted runtime applies the same rules to its IndexedDB snapshot.
- Korean initial-consonant search: `books` gains a nullable `title_choseong` column
  (Hangul syllables replaced by their initial consonants, whitespace removed, the rest
  lowercased). `syncBooks` fills it on every write and `ensureSchema` backfills existing
  rows in batches; a query matches the title or the initials field.
- A tag "Index" page. An icon in the sidebar Tags header (next to the total) opens
  `/tag-index`, which shows every tag as a card of a Pinterest-style masonry layout:
  the tag name on top and, inside, the titles of all books with that tag in a small
  font. A title opens the book in the viewer; the card header opens the tag page. A book
  with several tags appears in each of those cards. Backed by `GET /api/tags/index`
  (one query for all tags and their books).
- An "Untagged" entry pinned at the top of the sidebar tag list. It shows how many
  documents have no tag at all and opens `/untagged`, which lists them like a tag page
  (a document leaves the list as soon as it gets a tag). Backed by
  `GET /api/tags/untagged-books` and `GET /api/tags/untagged-count`.
- Background task layer for the standalone server: a standard task envelope and script
  contract, a priority queue, a fixed pool of worker threads, and an hourly scheduler
  that recomputes and replaces the pending queue on every run
  (`PDFIT_TASK_INTERVAL_MINUTES`, `PDFIT_TASK_CONCURRENCY`). `GET /api/tasks/status`
  reports it. The layer lives in the shared package (`createPdfitTaskScheduler`), and
  the thumbnail render script accepts a local file or an authenticated HTTP range
  source, so a hosted runtime can register its own jobs on the same scheduler.
- `prepare` hook on task definitions for inputs that must be fresh at dispatch time,
  and `queued`/`failed`/`missing` answers on the remote thumbnail route, so remote
  libraries use the same server-cover contract as local ones.
- Server-rendered cover thumbnails as the first background job. Covers are stored under
  `/app/data/thumbnails` and re-rendered when a PDF's modification time or size changes.

### Changed

- The cover card is now a thumbnail with four equal-width action buttons directly under
  it. The title sits in a two-line translucent black band over the bottom of the
  thumbnail. Tags, last opened time, last page, and size show in a translucent overlay
  on hover, or from the circled `i` button at the thumbnail's top right on devices
  without hover.
- The sidebar lists tags in Unicode (UTF-16 code unit) order of their names instead of
  bookstore-category groups, and each tag row starts with a tag icon in the tag's color
  instead of a `#` character.
- The standalone server starts Node with fixed glibc malloc thresholds so memory used
  by background workers is returned after a batch.
- The standalone cover view shows server thumbnails and no longer renders PDFs in the
  browser. A cover that is not ready yet is queued ahead of the backlog when its card
  is on screen.
- The upper-left sidebar button (language and light/dark dialog) shows a globe and is named
  Language, so it no longer duplicates the Settings gear. The PGVector settings tab and its
  `/api/settings/pgvector` routes are removed because the image embeds PostgreSQL and nothing
  read the values; existing `app_settings` rows are left untouched.

### Fixed

- Reopening a book restored the saved page but left wheel and key navigation on page 1, so
  the first wheel moved 1→2 until a prev/next button was clicked. The PDF.js viewer now syncs
  that state on document open and resets it when the document changes.

### Commit summary since 0.4.5

- `a653f22`, `98fb31e` — shared background task layer and server-rendered covers, local and remote.
- `71fc6c2` — cover card with the title over the thumbnail.
- `2bac552`, `8e3d5de`, `ad81b9c` — Unicode tag order and tag icons in the sidebar.
- `1d857f6` — language globe, PGVector settings tab removed.
- `dca5199` — restored-page wheel fix.
- `e428a6d`, `12c41c0` — title search and initial-consonant search.
- `fb40fd1` — Untagged entry.
- `7fb4840`, `593b167` — tag Index page and its left-to-right, lowest-column placement.

## [0.4.5] - 2026-11-09

PDFit 0.4.5 adds the cover (image list) view to the standalone library, merges
the library, viewer, and tagging work published in `e38a163`, and repairs the
`npx pdfit` launcher for the new standalone runtime.

### Added

- Cover view for folder and tag pages: a list/cover toggle shows a card grid
  with each PDF's first page, tags, last-opened time, and size. Local libraries
  render covers in the browser with PDF.js range reads and keep them in Cache
  Storage; the choice of view is remembered per browser.
- Document information, PDF export/download (including iPad Safari), bulk and
  title-based automatic tagging, tag colors and groups, light themes, language
  switching, tablet page gestures, and Acrobat-compatible zoom (`e38a163`).
- `npm run deploy:standalone` to build and recreate only the standalone `pdfit`
  service.

### Changed

- The standalone app runs under the Compose profile `standalone` on port
  `15203` (`PDFIT_STANDALONE_PORT`). Port `15201` and `npm run deploy` now belong
  to the hosted service.
- `npx pdfit` deploys only the standalone service, binds the chosen folder as
  the library, detects a private LAN IPv4 address for the LAN port, opens port
  `15203`, and accepts `--no-open`.
- Compose reads `PDFIT_LAN_BIND_ADDRESS`, `PDFIT_BOOKS_SOURCE`, and
  `PDFIT_DATA_PATH`; defaults keep the NAS volume and the existing data folder.
- The release contract pins `@pdfgpu/core@0.1.9-pdfit.1`.

### Fixed

- A client that aborts a PDF read mid-stream (a closed tab or a cancelled cover
  render) no longer crashes the server with `ERR_HTTP_HEADERS_SENT`.
- `npm install <git url>` followed by `npx pdfit` works from an empty folder:
  the launcher installs build dependencies on first run, the shared package
  copies its i18n catalogs into `dist`, and `.env` creation skips invalid lines
  from `.env.example`.

### Commit summary since 0.4.4

- `e38a163` — viewer, library, tagging, and deployment tool update.
- `6f84c1b` — configurable standalone LAN bind and `deploy:standalone`.
- `ac0afd9` — launcher fix and aborted-read crash fix.
- `2d7a711`, `1083e5e`, `8469b69` — Git-URL install fixes.

## [0.4.4] - 2026-08-21

PDFit 0.4.4 improves viewer and library interaction feedback.

- Start PDF viewing with neither width fit nor height fit selected.
- Keep viewer headers and controls visible during reading interactions.
- Restrict PDF detail navigation and its pointer cursor to the filename only.
- Show tag dialogs immediately and apply tag changes optimistically with
  pending, success, failure, and rollback feedback.

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
