# Page text popup test plan

Created 2026-11-27.

## Environment

Use a Free Docker instance with its own library and data paths, a Chromium
browser, and two generated PDFs in a folder named `Fixtures`. Generate
`Page OCR A.pdf` with three text-layer pages and `Page OCR B.pdf` with one,
using [buildPdf](../../../../packages/pdfit/tests/fixtures/pdfFixture.mjs).
Leave the third page of the first book unscanned.

## Steps

1. Run `npm run test:ocr`. Check revision changes, stale edit rejection,
   the result after clearing a page, and preservation on reread.
2. Probe Docker health and confirm both PDF files are visible inside the container.
3. Set `PDFIT_OCR_POPUP_TEST_ORIGIN` to the isolated runtime and run
   `node apps/pdfit/tests/page-ocr-popup-browser.mjs`. Resize and drag the
   popup, save Markdown, scroll a long result, change pages through saved and
   unscanned results, and reopen the viewer and another book.
4. Check that copy returns raw Markdown and that reload preserves the OCR edit.
   Confirm another book opens with its own geometry and the original book
   restores its four saved values. Shrink the viewport and check the window fits.

The browser locates the dialog by page title and uses named controls for the
window movement, resizing, editing, navigation, and close actions.
`page-ocr-scroll` identifies the internal scrollport. Capture screenshots,
window rectangles, and browser errors under `test/20261127/page-ocr-popup/`.
