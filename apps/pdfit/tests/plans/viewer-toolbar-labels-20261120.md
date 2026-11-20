# Viewer toolbar labels

Created 2026-11-20.

## Goal and setup

Verify the [shared toolbar](../../../../packages/pdfit/src/front/components/ViewerToolbar/index.tsx) on an isolated standalone Docker instance with bundled Chromium. Use a disposable books directory and database. Set `PDFIT_TOOLBAR_FIXTURE_ROOT` to that books directory and run `node apps/pdfit/tests/viewer-toolbar-labels-browser.mjs` to seed a three-page PDF before starting the service. Clear that variable, deploy via `npm run deploy:standalone`, check `/health` and confirm the fixture PDF is visible inside the container.

## Scenario

Set `PDFIT_TEST_ORIGIN` to the candidate origin and rerun the browser script. It opens the PDF in Korean through the PDF.js and PDFGPU viewer paths and records the active backend. Verify OCR and Download appear only in the toolbar, each icon has a small English label below it, and button names remain Korean. At 1440 px all groups fit in one row, and at 375 px the groups wrap into three rows without horizontal overflow. Switch to two pages to check the Cover label, switch back, enter a custom zoom, navigate to page 2, read its text by OCR, and download and compare the full PDF bytes.

## Evidence and locators

Use the `viewer controls` toolbar, button roles with localized names, and the numeric input textbox labels. `page-ocr-open` and `document-export-open` identify the action buttons when checking the title header. `spread-cover-alone`, `viewer-page-indicator`, and `page-ocr-text` identify the conditional cover toggle, page count, and OCR result. Record container health, the OCR request page and response code, downloaded bytes, JavaScript errors, and screenshots for both widths and engines under `test/YYYYMMDD/`.
