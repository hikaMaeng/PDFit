# Test Plan: Acrobat-compatible viewer zoom

## Scope

Verify that the PDF.js viewer interprets the displayed zoom percentage using the
same 96-CSS-DPI convention as Acrobat while preserving fit controls and PDF-point
coordinate data.

## Environment

- Windows 11
- root `docker-compose.yml` service container
- Chromium through the repository Playwright dependency
- Letter-size fixture with `MediaBox [0 0 612 792]`

## Steps

1. Build the shared package and application.
2. Run the pure display-scale tests against compiled output.
3. Rebuild and recreate the root Compose `service` container.
4. Open the deployed viewer with the PDF.js engine and no saved viewer state.
5. Assert that the zoom input remains `100` and the page is `816 x 1056` CSS pixels.
6. Enter 125% and assert that the page is `1020 x 1320` CSS pixels.
7. Activate fit-width and fit-height, then assert the page matches the available
   viewport extent and the displayed percentage is converted back from CSS pixels.
8. Assert that no browser console or page errors occurred.

## Expected Result

The displayed zoom remains a stable user-facing ratio, 100% matches Acrobat's
96-DPI page size, fit controls remain exact, and persisted PDF coordinates do not
change.
