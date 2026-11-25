# Book card comment badges

Created 2026-11-25.

## Environment and fixture

Use the standalone deploy entrypoint with an isolated Compose project, loopback port, and disposable PostgreSQL, bookmark, and PDF directories. Name the library `Comment test library`. Put two valid PDFs named `Badge count.pdf` and `Empty count.pdf` under `Badges`. Start with no comment rows for these books.

## Scenario

1. Set `PDFIT_TEST_ORIGIN` and `PDFIT_TEST_ARTIFACT_DIR`. Run `node apps/pdfit/tests/book-comment-badges-browser.mjs`.
2. Verify that previously saved comments and an empty board display their counts before either board is opened. Both card counts are requested together.
3. Add comments through the board while a second tab shows the same folder in dark mode. Check all eleven distinct SVG graphics, the gray zero, and the yellow positive counts. Check that nine transitions to `9+` with a tooltip showing ten.
4. Reload one tab and delete the tenth comment. Both tabs show nine and the other book still shows zero.

Scope the `코멘트` button inside its card by accessible name and the exact count by accessible description. Capture /health and container health, Chromium page errors, screenshots, and the Playwright trace.
