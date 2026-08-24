# Viewer default fit and UI visibility

## Goal

Verify that opening a PDF starts with neither fit control selected and that ordinary reading interactions cannot hide the viewer header or toolbar.

## Environment

- Windows 11 host
- Root `docker-compose.yml` PDFit service on port `15201`
- Production Vite bundle served by the Express container
- In-app Chromium browser

## Steps

1. Build the shared PDFit package and run its PDFGPU integration tests.
2. Build the complete monorepo and deploy the PDFit service through the root compose entry point.
3. Open an existing 472-page PDF that may have persisted viewer state.
4. Wait for PDFGPU to report a non-zero page count.
5. Assert that the width-fit and height-fit icon buttons do not use the selected color.
6. Click the center of the viewer, press Space, and reload the page.
7. After each interaction, assert that the viewer toolbar remains present.
8. Check browser console errors and Docker service health.

## Expected result

- Both fit controls are unselected on every initial load.
- A previously persisted fit mode does not restore its calculated fit scale.
- The header and toolbar remain visible after center click, Space, and reload.
- Build, integration checks, browser checks, and container health all pass.
