# Free cover view and standalone redeploy plan — 2026-11-09

## Goal

Bring the paid edition's book-list cover (image list) view to the Free app and
redeploy the Free container without deleting PostgreSQL table data.

## Source of the feature

The cover view was not on any remote until `e38a163` (권현경, 2026-11-09) was
pushed to `hikaMaeng/PDFit`. It lives in the shared package
(`FolderPage`, `TagPage`, `PdfCoverItem`), so Free receives it through the shared
build. Free has no Drive thumbnail and renders the first page with PDF.js.

## Acceptance criteria

1. Free folder pages offer a list/cover toggle; the cover view shows first-page
   covers with title, tags, last-opened time, size, and actions.
2. The redeployed Free container is healthy and reports `0.4.4`.
3. No PostgreSQL table loses rows across the redeploy.

## Steps

1. Fast-forward the public repo and both private checkouts (stash local Pro edits).
2. Check new schema code for destructive statements; check Docker asset changes.
3. `npm install`, `npm run build`.
4. Make the standalone LAN bind address configurable; set this host's address in `.env`.
5. Record row counts and `pg_dump` the database.
6. Deploy the standalone `pdfit` service; add and run `npm run deploy:standalone`.
7. Compare row counts; check health, ports, version.
8. Run `apps/pdfit/tests/free-cover-view-deployed-browser.mjs` against port 15203.
