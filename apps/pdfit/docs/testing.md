# Testing

Run:

* `npm run build`
* `npm run verify:repo`
* `npm run deploy:standalone`
* `npm run verify:pdfit`
* `npm run verify:pdfit:acceptance`
* `npm run test:pdfgpu`

`apps/pdfit/tests/free-cover-view-deployed-browser.mjs` is a read-only headless check of the cover view against a deployed standalone server (`PDFIT_BASE_URL`, default `http://127.0.0.1:15203`). It reads `/api/tasks/status`, switches to the grid, and asserts that at least `PDFIT_MIN_READY_COVERS` covers are loaded 360 px wide server thumbnails with non-blank pixels and a `v=<mtime>-<size>` URL, that the page contains no browser-side PDF canvas, that no PDF file was downloaded, and that the view choice persists. `PDFIT_WAIT_TASKS_IDLE_SECONDS` waits for the task queue to drain first. Set `PDFIT_BROWSER_CHANNEL=chrome` to use an installed Chrome, and `PDFIT_EVIDENCE_DIR` to save a screenshot and JSON.

`apps/pdfit/tests/viewer-restored-page-wheel-browser.mjs` mocks a saved viewer state (page 5, single and double layout) on an 8-page PDF, opens `/viewer/...` on the standalone server (`PDFIT_TEST_ORIGIN`, default `http://127.0.0.1:15203`), and asserts that the first mouse wheel without any prev/next click moves from the restored page (`5→6` single, `5→7` double). `PDFIT_TEST_CHANNEL=chrome` uses the installed Chrome; `PDFIT_TEST_RUN` names the report directory.

`apps/pdfit/tests/pdfgpu-0110-viewer-browser.mjs` checks the `@pdfgpu/core@0.1.10` integration on a deployed standalone server (`PDFIT_TEST_ORIGIN`, default `http://127.0.0.1:15203`; `PDFIT_TEST_CHANNEL=chrome` uses the installed Chrome; `PDFIT_TEST_RUN` names `apps/pdfit/tests/reports/pdfgpu-0110-integration/<run>/`). It blocks every non-GET request so the library and reading positions stay unchanged, opens the smallest library book with at least 8 pages, and asserts: PDF.js two-page rows (1,2),(3,4),(5,6) by default and (1),(2,3),(4,5) after **표지 따로 보기** through the buttons and PageDown/PageUp, the choice surviving a reload; the GPU viewer starting `pdfiumWorkerMain` workers and painting a canvas; and one PageDown moving exactly one page with and without viewport focus. `packages/pdfit/tests/spread-pairing.test.mjs` (run by `npm run test:pdfgpu`) checks both pairings against written-out row lists.

`apps/pdfit/tests/viewer-double-fit-height-browser.mjs` also honours `PDFIT_TEST_CHANNEL`. Its next two-page row after page 1 is `3` for PDF.js (paired default) and `2` for `--gpu` (the core lays out the cover alone; the old `3` matched the pre-0.1.10 landing on the right half of row (2,3)). After the first swipe it waits for loading to finish and asserts that the turned page does not snap back to the saved page.

`apps/pdfit/tests/untagged-browser.mjs` checks the sidebar "Untagged" entry on a deployed standalone server (`PDFIT_TEST_ORIGIN`, default `http://127.0.0.1:15203`; `PDFIT_TEST_CHANNEL=chrome` uses the installed Chrome; `PDFIT_TEST_RUN` names the report directory). Part A is read-only against the real library: the entry is the first tag row, its badge, the `/untagged` title chip and the list rows all equal `GET /api/tags/untagged-count`/`untagged-books`, and it is deselected on a real tag page. Part B intercepts the untagged routes and the tag-add POST, adds a tag in the dialog and asserts the document leaves the list and the badge drops. `packages/pdfit/tests/untagged-books.test.mjs` covers the routes (including a real tag named `untagged-books` still using `/:tag/books`) and, with `PDFIT_TEST_DATABASE_URL` set, the PostgreSQL query in an isolated schema.

`apps/pdfit/tests/tag-index-browser.mjs` checks the tag "Index" page on a deployed standalone server (`PDFIT_TEST_ORIGIN`, default `http://127.0.0.1:15203`; `PDFIT_TEST_CHANNEL=chrome` uses the installed Chrome; `PDFIT_TEST_RUN` names the report directory). It is read-only against the real library: it rebuilds the expected cards independently from `GET /api/tags/summary` plus one `GET /api/tags/:tag/books` per tag and compares tag order, card book counts, book titles and the header chip with the page, checks that the icon in the sidebar Tags header opens `/tag-index` without collapsing the section, that cards sit in more than one column with different heights and are placed Pinterest-style (walking the cards in tag order from the rendered coordinates, each one sits in the column whose bottom is highest at that point, ties to the left, so the first row fills left to right), and that a title click opens the viewer and a card header opens the tag page. `packages/pdfit/tests/tag-index.test.mjs` covers the route (including a real tag named `index` still using `/:tag/books`, and `501`) and, with `PDFIT_TEST_DATABASE_URL` set, the PostgreSQL query against `listTagSummaries`/`listBooksByTag` in an isolated schema.

`apps/pdfit/tests/credentials-url-browser.mjs` checks that the app works when opened from `http://user:pass@host/`. It starts its own Basic-auth reverse proxy (random port, throwaway credentials) in front of the deployed server (`PDFIT_TEST_ORIGIN`, default `http://127.0.0.1:15203`; `PDFIT_TEST_CHANNEL=chrome` uses the installed Chrome; `PDFIT_TEST_RUN` names the report directory) and is read-only against the library. A: through the credential address the sidebar shows as many folder rows as `GET /api/folders`, the tag-link total equals the sum of `GET /api/tags/summary`, tag rows equal the summary length, `document.baseURI` carries no credentials, a relative `fetch('/api/folders')` returns 200, there is no credentials `fetch` error, and the proxy received authenticated API requests. B: control with a credential-free address and the browser's own credentials. C: the same address on `/viewer/...`. Before the fix this test fails (`TypeError ... URL that includes credentials`, zero API requests reach the proxy). Fix: `front/api/credentialFreeBase.ts`, called first in `createPdfitServiceApp` and `createPdfitViewerApp`. Plan `tests/plans/credentials-url-20261111.md`, report `tests/reports/credentials-url/20261111.md`.

`apps/pdfit/tests/cover-last-page-browser.mjs` checks the cover card info overlay's "Last page" on a deployed standalone server (`PDFIT_TEST_ORIGIN`, default `http://127.0.0.1:15203`; `PDFIT_TEST_FOLDER`, default `이북`; `PDFIT_TEST_CHANNEL=chrome` uses the installed Chrome; `PDFIT_TEST_RUN` names the report directory). Read-only: it finds a book whose `GET /api/viewer-state/...` page is above 1 and a book without saved state, opens the overlay of each in cover view, and asserts that the first shows that page, the second shows `—`, there is no `pageerror` and no non-GET request. It reports `SKIP` when the library has no book with a saved page. Before the fix it fails (the saved-page book showed `—`). Plan `tests/plans/cover-last-page-20261111.md`, report `tests/reports/cover-last-page/20261111.md`.

`apps/pdfit/tests/aborted-file-read.mjs` aborts several range reads of a large PDF mid-stream and asserts that `/health` stays 200 and the container restart count (`PDFIT_CONTAINER`) does not change. Before the fix in `routes/folders.ts`, the first abort crashed Node with `ERR_HTTP_HEADERS_SENT`.

`verify:pdfit` checks the integrated service/viewer bundles, Settings UI, AI server CRUD, the removed `/api/settings/pgvector` routes returning 404, and viewer isolation. Acceptance covers library CRUD, upload, tags, progress, viewer state, and SSE behavior.

Acceptance is destructive by design and is fail-closed: it refuses the production
port `15201` and refuses to reset any repository runtime data directory. Run it
only against a separately provisioned test Compose project and test database,
with `PDFIT_ACCEPTANCE_ALLOW_DESTRUCTIVE_RESET=PDFIT-ACCEPTANCE-ISOLATED-RESET`.
Set `PDFIT_ACCEPTANCE_BASE_URL` to the isolated service URL when invoking the npm
verification script on platforms that consume `--base-url` as an npm option. Use
`PDFIT_ACCEPTANCE_REPORT_PATH` to keep disposable verification evidence outside the
checked-in report directory.

Plans and reports are under `apps/pdfit/tests/plans/` and `apps/pdfit/tests/reports/`. Browser screenshots and machine-readable artifacts belong under `test/YYYYMMDD/<run>/`.

The LinkCpp-inspired shell verification is recorded in `apps/pdfit/tests/reports/ui-theme/20260805_205600.md`, with browser evidence under `test/20260805/20260805_linkcpp-theme-smoke/`.

`tests/free-settings-globe-deployed-browser.mjs` is a read-only check of a deployed Free app (`PDFIT_BASE_URL`, `PDFIT_EVIDENCE_DIR`, `PDFIT_BROWSER_CHANNEL=chrome`): the upper-left globe button (`lnb-preferences`) opens the language/theme dialog and `/settings` shows only the AI servers tab. Latest report: `tests/reports/settings-globe-pgvector-removal-20261110.md`.

Title search: `packages/pdfit/tests/title-search.test.mjs` runs against `dist` (build first). The route tests need nothing else; the PostgreSQL test runs only with `PDFIT_TEST_DATABASE_URL` and uses a throwaway schema. `tests/title-search-browser.mjs` drives the deployed app (`PDFIT_TEST_BASE_URL`, default `http://localhost:15203`; set `PDFIT_TEST_CHROMIUM_PATH` when Playwright's bundled browser is not installed). The same test file covers initials search (`titleChoseong`, the `title_choseong` write/backfill/re-sync paths). Plan `tests/plans/title-search-20261110.md`, reports `tests/reports/title-search/20261110.md` and `tests/reports/title-search/20261110-choseong.md`.
