# Report: folder list while the library volume is offline (2026-11-15)

## Before (volume down, container `pdfit-pdfit-1` unhealthy)
- `GET /api/folders`: 60.0 s (no response, curl timeout) and 500 after 46.9 s.
- Container log: repeated `ERROR GET / 500 (30630ms)` / `(61434ms)`; `ls /app/data/books` -> `Host is down`.
- `GET /api/tags` 0.11 s, `GET /api/tasks/status` 0.007 s (database / memory only).
- Cause: `listFolderShells()` used `existsSync` + `readdirSync` on the mount, blocking the event loop.

## After
- `node --test packages/pdfit/tests/folders-offline-volume.test.mjs`: 3 pass, 0 fail
  (hang forever 79 ms, EHOSTDOWN 16 ms, disk-only folder merged).
- `npm run test:tasks`: 10 pass, 0 fail.
- `npm run build`: 4 successful.
- `npm run deploy:standalone`: container healthy; log `Library index ready: 719 PDFs across 2 folders.`
- Volume was reachable again at verification time: `GET /api/folders` 200 in 0.100 s,
  `/api/tags` 0.016 s, `/api/tasks/status` 0.005 s.
- Browser (127.0.0.1:15203): sidebar lists the tag list and the folder `AX` (rename/delete buttons present).

## Not verified
- The live container was not tested with the NAS down after the fix (the NAS came back); the outage
  behaviour is covered by the unit test with a hanging and a failing volume read only.
- `POST /api/folders/refresh` against a dead mount was not exercised at runtime.
