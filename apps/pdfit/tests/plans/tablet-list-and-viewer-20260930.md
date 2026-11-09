# Tablet library and viewer layout

## Purpose

Verify that folder/tag document columns remain aligned on a touch tablet without changing the established desktop layout, and inspect first-page loading and toolbar visibility in the PDF viewer.

## Environment

- Windows 11 host, local Docker Compose `service` at `http://127.0.0.1:15201`.
- Local-preview test account with a root folder, tag `자기계발`, and `코어 코틀린.pdf`.
- Playwright Chromium: 1280×800 mouse desktop, 810×1080 touch tablet, 390×844 touch phone, and 810×1080 mouse desktop.
- Playwright WebKit 810×1080 touch profile for a Safari-engine approximation. This does not replace validation on the physical iPad.

## Steps

1. Build `@pdfit/pdfit` and `service`, update `service` through root Docker Compose, and wait for health.
2. Run `node apps/pdfit/tests/tablet-library-layout-browser.mjs`.
3. On `/folder/PDFit%20Library` and `/tag/자기계발`, measure heading and first-row cell coordinates, tag action bounds, horizontal overflow, and row height; save screenshots.
4. Assert five aligned columns on 1280px desktop and 810px touch tablet. Assert compact wrapping remains at 810px mouse desktop and 390px touch phone.
5. Run `node apps/pdfit/tests/tablet-viewer-loading-browser.mjs` to time first visible toolbar on desktop and touch tablet, confirm a 16 MiB PDF uses one authenticated HEAD plus one GET (no byte ranges), log durations, and verify toolbar/page indicator bounds after enabling continuous scroll and scrolling to another page.
6. Repeat the toolbar check with WebKit and, if network access obscures UI behavior, use an in-memory copy of the same PDF for deterministic browser rendering. Record any limitation.
7. Re-run the existing document metadata, light theme, and library alignment browser checks to catch regressions.

## Pass criteria

- Root-folder and tag-list headings and row cells have matching columns on touch tablet, with no horizontal viewport overflow.
- Standard and narrow mouse desktop remain on their intended prior layouts.
- The page-mode toolbar and page indicator remain in the viewport after continuous scrolling in tested browser engines.
- Build and Docker health succeed; all checks and limitations are recorded in a timestamped report.
