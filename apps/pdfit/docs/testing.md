# Testing

Run:

* `npm run build`
* `npm run verify:repo`
* `npm run deploy`
* `npm run verify:pdfit`
* `npm run verify:pdfit:acceptance`
* `npm run test:pdfgpu`

`verify:pdfit` checks the integrated service/viewer bundles, Settings UI, AI server CRUD, pgvector persistence, and viewer isolation. Acceptance covers library CRUD, upload, tags, progress, viewer state, and SSE behavior.

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
