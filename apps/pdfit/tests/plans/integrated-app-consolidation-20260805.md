# Test Plan: integrated-app-consolidation

## Scope

Verify that the former Free and Pro applications are delivered as one `apps/pdfit` artifact and one Docker Compose service while retaining library, viewer, WebGPU, Settings, PostgreSQL, and pgvector behavior.

## Preconditions

* `apps/pdfit` is the only tracked app module.
* Compose service `pdfit` publishes `15201`.
* Host library root is `S:/bside/이북`, bridged through WSL to `/app/data/books`.

## Steps

1. Run `npm run build`.
2. Run `npm run verify:repo`.
3. Run `npm run deploy`.
4. Run `npm run verify:pdfit`.
5. Run the headless smoke and integrated browser scenario against `http://127.0.0.1:15201`.
6. Confirm the container exposes `vector` and `textsearch_ko` extensions.
7. Run `npm run test:pdfgpu`.
8. Run the integrated acceptance matrix and record any external bind limitation.

## Pass criteria

* No `apps/free` or `apps/pro` tracked app remains.
* One healthy `pdfit` container serves `/`, `/settings`, and `/viewer`.
* Settings API CRUD and pgvector persistence pass.
* Browser scenario has zero console/page errors and captures home, settings, and viewer screenshots.
* Acceptance either passes or records a concrete environment limitation with cleanup evidence.
