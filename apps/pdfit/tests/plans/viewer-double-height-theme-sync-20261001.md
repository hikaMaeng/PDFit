# Two-page height fit and cross-window viewer theme

## Scope

An existing 150% manual zoom must be replaced by either fit action. In a
two-page layout, height fit may not expand the spread beyond the viewport
width, including short landscape-like pages. A viewer already open in another
window must respond when the library changes `pdfit.color-mode`.

## Environment

- Windows 11, root Compose `service` at `http://127.0.0.1:15201`.
- Playwright Chromium (PDF.js and PDFGPU) and WebKit (PDF.js), 1280 × 800.
- Synthetic two-page PDFs at 612 × 792 and 612 × 400 PDF points.
- PDFGPU tests allow WASM in the test page response only; production CSP is
  unchanged and may select the PDF.js fallback.

## Procedure and acceptance

1. Build `@pdfit/pdfit` and `service`; update root Compose and confirm healthy.
2. Run `node apps/pdfit/tests/viewer-double-fit-height-browser.mjs` for both
   page heights, and repeat with `--gpu`. Select two-page mode, manually set
   150%, click width fit, restore 150%, then click height fit. Both actions
   must replace 150%; after height fit, the spread width and page height must
   fit inside the viewport.
3. Run `node apps/pdfit/tests/viewer-light-canvas-browser.mjs`, `--webkit`,
   and `--gpu`. Verify both themes, including toolbar and canvas colors.
   In light mode, a second same-origin tab changes localStorage dark then light;
   the already-open viewer must follow both changes without reload.
4. Run the existing one-page zoom browser test as a regression check and
   `git diff --check`. Record timings/results, failures, Docker state, and
   whether a new deployment package was created.
