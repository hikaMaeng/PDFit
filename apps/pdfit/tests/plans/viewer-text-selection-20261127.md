# Viewer text selection

Created 2026-11-27.

Run against the Free Docker viewer on port 15203 with Playwright and Chrome.
The browser script supplies a two-page PDF with embedded text and a PDF with
only a raster image. The fixture routes keep the library and annotations free
of test writes. Set `PDFIT_TEXT_SELECTION_FONT` to a Hangul font if Malgun
Gothic is unavailable.

Run `node apps/pdfit/tests/viewer-text-selection-browser.mjs` from the
workspace root.

- Open the digital PDF. Drag the text and copy it with Ctrl+C. Verify the
  clipboard and confirm the browser fetched no OCR assets.
- Activate Freehand drawing on the left toolbar. Check that the selection
  disappears. Press the same tool again and repeat the copy. Zoom in and
  move to the next page, then copy again.
- Open the raster-only PDF. Copy an English line, a range across lines, and
  a Korean word from the page. Inspect request URLs for same-origin models
  and record page errors.
- Emulate a Chromium touch pointer. Hold the Korean word and use **Copy
  text** to verify the clipboard.

For OCR copy spacing, run `node --test packages/pdfit/tests/viewer-ocr-layout.test.mjs`
after building the shared package. Test fragmented Korean words, real
spaces, and wrapped prose beside headings and code. When the local sample
from the incident is available, copy the heading and the following
paragraph on PDF page 175 and compare the clipboard with the visible text.

Find the viewport and selectable pages by `pdfgpu-scroll-area` and
`pdf-selectable-page`. Use the exact tool names and fixture text for the
other locators. Save the request and clipboard results and the selected
text screenshots under `test/20261127/viewer-text-selection/`.
