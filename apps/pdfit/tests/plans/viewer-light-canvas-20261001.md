# Viewer workspace light-mode contrast

## Goal

In light mode the PDF workspace surrounding the document is a light blue-gray
surface, rather than the fixed dark gray shown in the user screenshot. Dark mode
must retain its original background. The bookmark sidebar must remain readable.

## Environment and steps

- Windows 11, local root Compose `service` at `http://127.0.0.1:15201`.
- Build `@pdfit/pdfit` and `service`, update the root Compose service, and wait
  for a healthy container.
- Run `node apps/pdfit/tests/viewer-light-canvas-browser.mjs` and `--webkit` for
  the PDF.js renderer; run `--gpu` for PDFGPU in Chromium. The GPU browser test
  may permit WASM in the test page response only, since the production CSP
  currently causes an automatic PDF.js fallback.
- For each engine, open a synthetic two-page PDF in light and dark modes.
  Assert computed workspace backgrounds `rgb(232, 241, 248)` and
  `rgb(58, 58, 58)`. Switch to two-page and continuous scrolling and assert
  no color regression. Open the bookmark panel and assert its light/dark
  backgrounds. Save screenshots for visual QA and record page errors.
- Run `git diff --check`, verify the Docker container is healthy, then stage a
  new Windows AMD64 distribution ZIP without replacing any existing release.
  Verify ZIP and image hashes, archive contents, configuration syntax, and
  absence of user data or populated sensitive settings.
