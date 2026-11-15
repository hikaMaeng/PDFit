# Plan: folder list while the library volume is offline (2026-11-15)

Criterion (user): the folder list must render from the database regardless of NAS state, and not be slow.

1. Reproduce: with the volume down (`ls /app/data/books` -> `Host is down`), time `GET /api/folders`.
2. Fix: DB-only list, async disk-folder cache, async watcher refresh.
3. Unit: `packages/pdfit/tests/folders-offline-volume.test.mjs` (hang, EHOSTDOWN, disk-only folder).
4. Deploy: `npm run deploy:standalone`, then timing and sidebar check in the browser.
