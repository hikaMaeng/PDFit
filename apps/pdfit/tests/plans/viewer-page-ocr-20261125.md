# Viewer page OCR navigation

Created 2026-11-25.

## Setup

Use an isolated standalone Docker runtime with a fresh database and a host-mounted fixture directory. Set `PDFIT_TOOLBAR_FIXTURE_ROOT` to that directory and run `node apps/pdfit/tests/viewer-toolbar-labels-browser.mjs` to create two three-page text PDFs. Clear the variable, deploy with `npm run deploy:standalone`, and verify HTTP health and fixture visibility inside the container.

## Scenario

Run the same browser script with `PDFIT_TEST_ORIGIN` set to the candidate origin. It seeds OCR for page 1 of each fixture. Open the PDF.js and PDFGPU viewer paths and repeat the following checks.

1. Open OCR from viewer page 2. The dialog shows the unscanned message and the network sees only a cache lookup for page index 1.
2. Browse to page 1 and read its saved text. Browse through page 2 to page 3. Previous is disabled at page 1 and Next at page 3. Browsing sends only GET requests.
3. Return to page 2 and start OCR with **Scan page**. Hold the POST while browsing away and back, then release it. Page 3 shows its own unscanned state, page 2 keeps its pending state, and a single POST for page index 1 returns the fixture text.
4. Browse to page 3 and close. The PDF stays on page 2. Reopen OCR and read the saved page 2 text through GET.

Use the localized dialog and button names with `getByRole`, and `page-ocr-text` for the result. Record HTTP health, container health, browser JavaScript errors, OCR requests and page indexes, and the 375 px unscanned and 1440 px scanned screenshots.

Run `npm run test:ocr` to verify the cache miss starts no worker or model call, old file stamps miss the cache, and a cache hit skips search-index writes.
