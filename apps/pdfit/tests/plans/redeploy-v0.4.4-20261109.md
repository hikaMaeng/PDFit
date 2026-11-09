# PDFit 0.4.4 local redeploy plan — 2026-11-09

## Goal

Replace the running `0.4.3` Free container with `0.4.4` through `npm run deploy`
without deleting PostgreSQL table data or bookmark assets.

## Data-safety checks before deploy

1. Confirm `PGDATA=/app/data/pgvector` sits on the host bind
   `apps/pdfit/docker/volumes/data`, so container removal keeps the database.
2. Confirm `schema_migrations` already holds `remove-bookmarks-v1`; otherwise the
   startup schema would `DROP TABLE bookmarks`.
3. Confirm the post-deploy library refresh is additive (`syncBooks` upserts only,
   `reconcile()` has no caller) and that startup does not scan the library.
4. Record per-table row counts.
5. `pg_dump` the database to the host bind before deploy.

## Steps

1. Push `main`.
2. Run `npm run deploy` (`rm -sf` without `-v`; volumes and binds are kept).
3. Compare per-table row counts with the pre-deploy record.
4. Check `/app/package.json` version, container health, `GET /health`, mounts.
5. Browser smoke: home version text, folder page counts, bookmarks page, console errors.

## Expected result

- No table loses rows; new `0.4.4` tables may appear empty.
- Container is healthy and reports `0.4.4`; browser shows `v0.4.4`.
