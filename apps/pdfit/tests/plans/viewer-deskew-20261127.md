# Viewer deskew test plan

Created 2026-11-27.

## Goal

Confirm that the PDFGPU viewer levels mildly skewed scan pages and keeps PDF-point annotations and bookmark clips aligned with the corrected page.

## Environment and preconditions

- Build PDFit with the clean, committed PDFGPU artifact identified in the release contract.
- Run the built Free viewer on a healthy Docker service. Use Chrome with a WebGPU device. Use separate contexts without the GPU API or with no available adapter for the error cases.
- Intercept the viewer APIs with a three-page PDF fixture. Give two scan pages opposite skew and use an upright page as the control. Keep annotation and bookmark writes in the test fixture.
- Set `PDFIT_TEST_ORIGIN` to the isolated instance and run `node apps/pdfit/tests/viewer-deskew-browser.mjs`. Set `PDFIT_TEST_OUTPUT` to keep evidence from separate builds.

## Steps and expected results

1. Open `/viewer/deskew/pages.pdf?driveFileId=deskew&page=1`. Verify the WebGPU backend and the current page in `viewer status`.
2. Verify the **기울임 보정** button starts off. Read the original angles and check that workers receive zero skew requests. Toggle correction on and verify each scan is level within 0.2°. Toggle it off and check the original angle returns. The current page, canvas, and PDF request count stay the same during a toggle.
3. Zoom in until detail tiles display. Measure the angle again and check that the rendered line and saved annotation stay aligned. Draw a line with the **선** tool and check that the saved endpoints match the original PDF coordinates.
4. Use the **클립** control to capture a rectangle across the line as soon as the page detail is available. Verify the scroll position stays fixed as loading completes. Decode the captured image and check that the line stays level. Check the saved `rect` in PDF points and the rotation of `bookmark-page-overlay`.
5. Open the viewer with `engine=legacy` in each WebGPU error context. Verify the error appears and the browser makes zero PDF requests.

## Evidence

Record the URL, Docker health, adapter, angles, capture and annotation coordinates, page errors and screenshots under `test/YYYYMMDD/<run>/`. Record the commands and results under `tests/reports/viewer-deskew/`.

Use `pdfgpu-scroll-area` to find the composited canvas, `viewer status` for quality and page state, and `annotation-line` and `bookmark-page-overlay` for overlay geometry.
