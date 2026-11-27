# Viewer popup geometry test plan

## Created

2026-11-27.

## Goal

Verify movement, resize limits, closing, and book-specific restoration for Bot, Comments, page OCR, and Contents in both viewer engines.

## Environment and preconditions

Build the shared package and standalone app. Use the standalone deployment entry point with a dedicated Compose project, loopback port, database directory, and library mount. Place `Popup A.pdf` and `Popup B.pdf` in the `Fixture` folder using `buildOutlinePdf({ outline: true })` from `packages/pdfit/tests/fixtures/outlinePdf.mjs`. Configure a headless Playwright Chromium with WebGPU fallback. No external model is required.

## Steps and expected results

1. Set `PDFIT_TEST_ORIGIN` to the fixture instance URL and `PDFIT_TEST_ARTIFACT_DIR` to a test artifact directory. Run `node apps/pdfit/tests/viewer-popup-geometry-browser.mjs`.
2. In each PDF.js and PDFGPU viewer, open every popup on book A. All are non-modal and have one X with 5 px between the button's right edge and the title bar's right edge.
3. Drag the move handle and shrink the popup past its minimum. It stays inside the viewer, keeps its top and left edges while resizing, and stops at a usable size. Drag outward and use an arrow key on the resize handle to grow it again.
4. Close and reopen the popup. Narrow the viewport and check the popup and X fit. Reopen at the original viewport size and check all four geometry values match.
5. Open book B and check the default geometry. Return to A with a fresh document load. Check the saved geometry is restored.
6. In touch-enabled mobile Chromium, resize each popup and tap the X once. The popup closes after that tap.

## Evidence and locators

Record the Docker health probe, browser result JSON, trace, screenshots, and page errors. Use the named dialog, the **Resize popup** and **Close** buttons, and the move handle's title. The OCR and Contents toolbar buttons expose `page-ocr-open` and `viewer-outline-open` test IDs.
