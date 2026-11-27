# Viewer deskew test plan

Created 2026-11-27.

## Goal

Confirm that the PDFGPU viewer levels mildly skewed scan pages and keeps PDF-point annotations and bookmark clips aligned with the corrected page.

## Environment and preconditions

- Build PDFit with the clean, committed PDFGPU artifact identified in the release contract.
- Run the built Free viewer on a healthy Docker service. Use Chromium with WebGPU and a separate context with `navigator.gpu` disabled for Canvas 2D.
- Intercept the viewer APIs with a three-page PDF fixture. Give two scan pages opposite skew and use an upright page as the control. Keep annotation and bookmark writes in the test fixture.
- Set `PDFIT_TEST_ORIGIN` to the isolated instance and run `node apps/pdfit/tests/viewer-deskew-browser.mjs`. Set `PDFIT_TEST_OUTPUT` to keep evidence from separate builds.

## Steps and expected results

1. Open `/viewer/deskew/pages.pdf?driveFileId=deskew&engine=gpu&page=1`. Verify the PDFGPU backend and the correct current page in `viewer status`.
2. Measure the angle of a colored line on the composited canvas for both scan pages. Check that both lines are level within 0.2°. Check that the upright page stays level. Open the same PDF in the PDF.js viewer and verify that the two original scan angles have opposite signs.
3. Zoom in until detail tiles display. Measure the angle again and check that the rendered line and saved annotation stay aligned. Draw a line with the **선** tool and check that the saved endpoints match the original PDF coordinates.
4. Use the **클립** control to capture a rectangle across the line as soon as the page detail is available. Verify the scroll position stays fixed as loading completes. Decode the captured image and check that the line stays level. Check the saved `rect` in PDF points and the rotation of `bookmark-page-overlay`.

## Evidence

Record the URL, Docker health, adapter, angles, capture and annotation coordinates, page errors and screenshots under `test/YYYYMMDD/<run>/`. Record the commands and results under `tests/reports/viewer-deskew/`.

Use `pdfgpu-scroll-area` to find the composited canvas, `viewer status` for quality and page state, and `annotation-line` and `bookmark-page-overlay` for overlay geometry.
