# Page text popup test plan

Created 2026-11-27.

## Environment

Use a Free Docker instance with its own library and data paths, a Chromium
browser, and two generated PDFs in a folder named `Fixtures`. Generate
`Page OCR A.pdf` with the text-layer pages `Fixture page one`,
`Fixture page two`, and `Fixture page three`. Generate a one-page
`Page OCR B with a long filename to check truncation when resizing the page text window.pdf`.
Use [buildPdf](../../../../packages/pdfit/tests/fixtures/pdfFixture.mjs).
Leave the third page of the first book unscanned.

## Steps

1. Run `npm run test:ocr`. Check revision changes, stale edit rejection,
   the result after clearing a page, and preservation on reread.
2. Probe Docker health and confirm both PDF files are visible inside the container.
3. Set `PDFIT_OCR_POPUP_TEST_ORIGIN` to the isolated runtime and run
   `node apps/pdfit/tests/page-ocr-popup-browser.mjs`. Resize and drag the
   popup, save Markdown, scroll a long result, browse saved and unscanned
   results, and use the **Move** button to navigate the underlying viewer.
   Repeat with `PDFIT_OCR_POPUP_TEST_ENGINE=gpu` and a separate artifact path.
4. Check that copy returns raw Markdown and that reload preserves the OCR edit.
   Confirm another book opens with its own geometry and the original book
   restores its four saved values. Shrink the long-filename window to
   400 × 280 CSS pixels and check the ellipsis and fixed control widths.
   Shrink the viewport and check the window fits with three named footer icons.
   Measure the close button's 5 CSS pixel inset from the right edge of the
   header in Korean and Arabic.

The browser locates the dialog by accessible page name. The header contains
the filename heading, `p.1`-style page text, and named viewer jump and
page arrow buttons. Check the named copy, reread, and edit buttons in the
footer and verify the elapsed time and source badge are absent.
`page-ocr-scroll` identifies the internal scrollport. Capture screenshots,
window rectangles, and browser errors under `test/20261127/page-ocr-popup/`.
