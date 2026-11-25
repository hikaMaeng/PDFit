# Viewer floating panels

2026-11-25. Run headless Chromium against the deployed local Free service. Use a
synthetic PDF and in-memory API responses so the checks leave the library intact.

1. Open `/viewer/panel-fixture/reader.pdf?engine=legacy`, then repeat with
   `engine=gpu`. Select width fit and record the PDF viewport and page bounds.
   Compare the viewport width with the main region, including in two-page and
   continuous modes.
2. Collapse the palette, drag it while collapsed, and expand it. Move it again
   with the arrow keys. Open Clips, move its list independently, close it, and
   reopen it at the saved location. Compare the viewport and page bounds and
   verify that moving either panel while armed makes no clip request.
3. Drag a rectangle on an uncovered part of the PDF. Verify one POST, a visible
   clip thumbnail, and capture turning off while the list remains open.
4. Resize to a narrow viewport. Verify both panels stay in bounds, move the
   clip list using an emulated touch gesture, then close it. Reload and verify
   both positions are remembered and the clip list starts closed.
5. Run `apps/pdfit/tests/viewer-fit-stability-browser.mjs` to check PDF.js zoom
   stability across resize and clip-list opening. Record Docker health,
   browser errors, screenshots, and Playwright traces.

Scope the collapse, expand, move, and Clips buttons to the **PDF annotation
tools** landmark. Scope **Move clip list** and **Close** to the **Clips**
landmark. Use `pdf-scroll-area` and `pdfgpu-scroll-area` for viewport geometry.
