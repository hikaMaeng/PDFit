# Test Plan: pdfgpu-viewer-integration

## Created

2026-08-05

## Goal

Verify that the merged PDFium/WebGPU viewer is the default Free viewer, that it preserves the legacy fallback contract, and that the deployed Free service remains healthy.

## Preconditions

* `npm run deploy` completed successfully.
* Free is reachable at `http://127.0.0.1:15201`.
* Docker Compose service `pdfit-free` is healthy.

## Steps

1. Run `npm run sync:pdfgpu` and `npm run test:pdfgpu`; core layout/cache/queue/DPI coverage runs in the independent pdfgpu repository and PDFit verifies the pinned artifact API.
2. Run `npm run verify:free` and `npm run verify:free:acceptance -- --group D`.
3. Run the headless viewer smoke test against `/viewer`.
4. Verify `/health` and record `docker compose ps` evidence.
5. Confirm the headless backend limitation is recorded separately from viewer rendering/fallback coverage.

## Expected Results

The PDFGPU unit suite passes, all viewer cases in acceptance group D pass, the smoke test passes, and the service returns HTTP 200 from `/health`. In headless Chromium, `backend: unsupported` is expected when WebGPU is unavailable; PDFium WASM rendering and the 2D fallback must remain usable.

## Artifacts

* `apps/free/tests/reports/free-acceptance-matrix/20260805_031550.md`
* `test/20260805/0318_free-viewer-smoke/report.md`
* `test/20260805/0318_free-viewer-smoke/screenshots/smoke.png`
