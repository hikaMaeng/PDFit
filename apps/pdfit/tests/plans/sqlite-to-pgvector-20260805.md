# Test Plan: sqlite-to-pgvector

## Created

2026-08-05

## Goal

Verify that the Free image embeds PostgreSQL with pgvector, that shared metadata no longer uses SQLite, and that the public Free API continues to provide the existing metadata behavior.

## Preconditions

* `npm run deploy` completed successfully.
* `pdfit-free` is reachable at `http://127.0.0.1:15201`.
* Docker and PostgreSQL data volumes are available.

## Steps

1. Build and deploy Free and Pro with `npm run deploy`.
2. Check `docker compose ps`, `/health`, and the container logs.
3. Query both embedded databases for `vector`, `textsearch_ko`, and shared metadata tables.
4. Exercise progress, tag, and viewer-state API writes and reads, then clean the probe rows.
5. If a legacy `app.db` exists, verify it is imported and renamed to a timestamped backup.
6. Run `npm run verify:free`, `npm run verify:free:acceptance -- --group D`, `npm run verify:pro`, and headless viewer smoke tests.

## Expected Results

Both application images run as single containers with PostgreSQL/pgvector; no separate database service is required. Shared metadata CRUD remains API-compatible and acceptance group D passes.

## Artifacts

* `apps/free/tests/reports/free-acceptance-matrix/20260805_034310.md`
* `apps/free/tests/reports/sqlite-to-pgvector/20260805_124629.md`
* `test/20260805/1246_free-pgvector-viewer-smoke/report.md`
