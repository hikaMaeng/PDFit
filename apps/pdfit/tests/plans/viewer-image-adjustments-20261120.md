# Viewer image adjustments

Created 2026-11-20.

## Setup

Use an isolated standalone Docker service and desktop Chrome with a WebGPU adapter. To seed the test library, set `PDFIT_IMAGE_FIXTURE_ROOT` to its disposable books directory and run `node apps/pdfit/tests/viewer-image-adjustments-browser.mjs`. Clear the variable and deploy with `npm run deploy:standalone`. Confirm HTTP 200 from `/health` and read access to `Toolbar fixture/Image colors.pdf` inside the container.

## Scenario

Set `PDFIT_TEST_ORIGIN` and rerun the script. It checks PDF.js, WebGPU, and PDFGPU's Canvas 2D path with `navigator.gpu` disabled. Open **Image** in `viewer controls` via the localized button name, then use the named dialog, the invert switch, sliders, preset buttons, and reset. Compare painted RGB with the known solid PDF color at each step. The WebGPU canvas must have no CSS filter. The two canvas paths must have one display filter. Check keyboard sliders and Escape, the open panel at 375 px, and restoration of an inversion saved to the real viewer-state route.

## Evidence

Save desktop and mobile screenshots and the backend, adapter, and measured RGB per scenario under `test/YYYYMMDD/`. Core coverage is in `F:/dev/pdfgpu/tests/playwright/pdfgpu-color-adjustments.spec.js`, which also checks previews, detail tiles, canvas gaps, and original capture pixels.
