# Test Plan: Viewer fit stability

Created 2026-11-23. Exercise Fit Width and Fit Height near the classic scrollbar
overflow thresholds in the default PDF.js viewer.

## Environment and steps

1. Run `node apps/pdfit/tests/viewer-fit-stability-browser.mjs` against Free at
   `http://127.0.0.1:15203`, or set `PDFIT_TEST_ORIGIN` to the test service.
   The script uses Windows Chromium with classic scrollbars and intercepts
   the viewer APIs with one-page landscape fixtures and continuous-scroll state.
2. Locate the two fit buttons by role and Korean accessible name. Use
   `pdf-scroll-area` to measure the visible canvas and available scrollport size.
   Record changed geometry for one second after each action.
3. Repeat the measurements across a window resize and, for width fit, after
   opening `legacy-bookmark-sidebar-toggle`.
4. Run `pdf-zoom-acrobat-browser.mjs` and `viewer-double-fit-height-browser.mjs`
   to cover manual zoom and two-page fit. Run the latter with `--gpu` as well.

## Acceptance

Each measured action applies one final page size. The fitted axis equals the
available scrollport extent minus padding within one CSS pixel. Browser errors
are empty. Retain the frame sequence and screenshots under `test/`.
