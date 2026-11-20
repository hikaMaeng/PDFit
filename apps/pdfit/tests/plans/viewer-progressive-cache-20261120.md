# Viewer progressive cache

Created 2026-11-20.

Run `npm run test:pdfgpu`, `npm run verify:repo`, and `npm run build`. Deploy Free with `npm run deploy:standalone`. Confirm Docker health, published HTTP health, and library visibility from inside the container.

Run `node apps/pdfit/tests/viewer-progressive-cache-browser.mjs` against the published loopback URL with desktop Chrome and a working WebGPU adapter. The scenario serves a synthetic 96-page PDF through a browser route and intercepts API writes.

- Open page 3 and use **Page number** in the **viewer controls** toolbar to jump to page 80. Confirm its fresh preview precedes detail, with a 200 ms stabilization delay before visible detail.
- Check that prefetch starts after 500 ms with pages 79 and 81 and extends past two neighboring pages. Navigate to page 81 and confirm the cached preview is painted without another request for it.
- Use **viewer status** for the backend, active page, and render quality. Read a center pixel inside the **PDF viewer** region to confirm both pages display the fixture colors. Capture screenshots, worker traces, and browser errors under `test/YYYYMMDD/`.
