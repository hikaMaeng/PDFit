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

`apps/pdfit/tests/untagged-browser.mjs` checks the sidebar "Untagged" entry on a deployed standalone server (`PDFIT_TEST_ORIGIN`, default `http://127.0.0.1:15203`; `PDFIT_TEST_CHANNEL=chrome` uses the installed Chrome; `PDFIT_TEST_RUN` names the report directory). Part A is read-only against the real library: the entry is the first tag row, its badge, the `/untagged` title chip and the list rows all equal `GET /api/tags/untagged-count`/`untagged-books`, and it is deselected on a real tag page. Part B intercepts the untagged routes and the tag-add POST, adds a tag in the dialog and asserts the document leaves the list and the badge drops. `packages/pdfit/tests/untagged-books.test.mjs` covers the routes (including a real tag named `untagged-books` still using `/:tag/books`) and, with `PDFIT_TEST_DATABASE_URL` set, the PostgreSQL query in an isolated schema.

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
