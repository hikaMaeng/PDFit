# Documentation and script consistency plan — 2026-11-09

## Goal

Align workspace documentation with the actual Compose file, library volume, container
name, release version, and maintainer-only scripts. No runtime file changes.

## Acceptance criteria

1. `docs/01` states that public source excludes the hosted edition and lists which
   commands need the private checkouts.
2. `docs/03` describes the external library volume (`PDFIT_BOOKS_VOLUME`,
   `PDFIT_BOOKS_SUBPATH`) and the bookmark path as written in `docker-compose.yml`,
   and states that parity needs private checkouts at `origin/main`.
3. `docs/04` names the real container (`pdfit-pdfit-1`) and its published interface.
4. `apps/pdfit/README.md` and `apps/pdfit/docs/usage.md` install `v0.4.4`, matching
   root `package.json`.
5. Root `test:service` is changed only if the scripts it calls are missing from the
   current private `apps/service` `origin/main`.

## Steps

1. Compare each statement against `docker-compose.yml`, `.env` key names, `docker ps`,
   and root `package.json`.
2. Extract private `origin/main` trees into a scratch directory and run
   `scripts/verify-service-parity.mjs` there (private checkouts are not modified).
3. Run `verify-service-parity.mjs` and `npm run verify:repo` against the local checkout.
4. Run `npm run verify:release-contract` and `docker compose config --quiet`.
5. Check `pdfit-pdfit-1` health and `GET /health`.
6. Confirm `git diff --name-only` lists Markdown files only.

## Not in scope

Deploy and browser checks: no runtime, build input, or UI file changes.
