# npx launcher standalone fix plan — 2026-11-09

## Goal

Make `npx pdfit <folder>` start the Free standalone app with the chosen folder as
its library, after the root Compose file moved Free to the `standalone` profile.

## Defects found

1. The launcher ran `npm run deploy`, which now deploys the hosted `service`.
2. It passed `PDFIT_BOOKS_HOST_PATH`, which Compose never reads; Compose mounted
   only the external volume `PDFIT_BOOKS_VOLUME`.
3. The LAN port bound `192.168.0.5` by default, which most hosts do not own.
4. It opened `http://127.0.0.1:15201`.
5. Found during verification: an aborted file read crashed the server
   (`ERR_HTTP_HEADERS_SENT` in `routes/folders.ts` `sendFile` callback).

## Acceptance criteria

- The launcher deploys only `pdfit`, binds the chosen folder, picks a host LAN
  address, and reports/opens the standalone URL.
- Default (non-launcher) deployments keep the external NAS volume and data path.
- Aborted reads leave the server healthy without a container restart.
- The real deployment keeps every table's row count.

## Steps

1. Compare `docker compose config` for default and launcher modes.
2. Run the launcher end to end in an isolated project
   (`COMPOSE_PROJECT_NAME=pdfitlaunchertest`, port 15299, separate data path).
3. Reproduce the abort crash on the pre-fix build in the isolated project, then
   rerun the launcher (rebuild with the fix) and repeat the check.
4. Back up the real database, run `npm run deploy:standalone`, compare row counts.
5. Run the abort check and the cover view check against the real server.
