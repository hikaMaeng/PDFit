# Tablet opened time and viewer navigation

## Scope

Verify that folder and tag document lists show the opened date and time on
separate, non-wrapping lines on a coarse-pointer tablet, while desktop keeps
one line. Verify that a scrolled tablet library can reopen its folder/tag
drawer and that cover-card links navigate through `/viewer/`, never the raw PDF
byte endpoint. Measure first-page loading and check that the viewer toolbar and
left annotation rail remain visible after switching to continuous scroll.

## Environment

- Root Compose `service` on `http://127.0.0.1:15201`, authenticated via local-preview.
- Playwright Chromium and WebKit, 810 × 900 or 810 × 1080 CSS pixels,
  touch enabled; desktop control at 1280 CSS pixels.
- Existing folder and tag documents, plus `코어 코틀린.pdf` for loading timing.

## Steps and acceptance

1. Build `@pdfit/pdfit` and `service`; rebuild root Compose `service`, wait for
   healthy status.
2. Run `node apps/pdfit/tests/tablet-opened-at-browser.mjs` and its `--webkit`
   variant. Both folder and tag routes must show date above time on tablet;
   desktop must retain one line. Scroll the folder page, reopen the drawer,
   and confirm cover link `href` begins `/viewer/`.
3. Run `node apps/pdfit/tests/tablet-viewer-loading-browser.mjs --tablet-only`
   and its `--webkit` variant. Capture HEAD/GET timings, toolbar and first
   canvas timing. After continuous-scroll selection and scrolling, the toolbar
   and annotation rail must remain on screen.
4. Check `git diff --check` and Docker health. Record failures and the exact
   browser/host boundary; local browser validation is not a physical iPad or
   production `pdfit.io` deployment test.
