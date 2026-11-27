# Internals

## Decisions

* One app owns both product capability sets so feature availability cannot drift between Free and Pro artifacts.
* One PostgreSQL pool stores both viewer metadata and application settings, while table names keep their bounded concerns.
* Legacy `pro_settings` data is copied into `app_settings` during schema setup to avoid losing existing settings during cutover.
* Docker remains the runtime boundary; the host build produces `apps/pdfit/dist` first.
* PDF.js viewer (`components/PdfViewer`): wheel and key navigation are computed from `interactionRef.page`, not from the `currentPage` state. Every path that sets the displayed page must also set `interactionRef` (`goToPage`, scroll detection, and the document-open restore). Restoring the saved page on open skips `goToPage`, so it syncs `interactionRef` itself; otherwise the first wheel after reopening a book moves from page 1 (`1→2`) until a prev/next button is clicked.
* The [PDFGPU viewer](../../../packages/pdfit/src/front/components/PdfGpuViewer/index.tsx) restores the page and scroll position once the page layout becomes available. The layout effect applies the position before the interactive view paints, so the later render-ready event cannot move the page during a clip drag.
