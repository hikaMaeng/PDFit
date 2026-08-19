# Architecture And Boundaries

## Shared package

`packages/pdfit` exports client service/viewer entries, the common server bootstrap, PostgreSQL metadata, and shared types. It owns the common route factories and WebGPU/PDFium viewer implementation.

Hosted storage variants also use the common server bootstrap, request-scoped
metadata router assembly, remote-library HTTP router, upload validation, and
byte-range parser. They provide storage/account adapters rather than a second
PDFit server implementation.

## Integrated app

`apps/pdfit` owns application composition:

* `src/front/main.tsx`: service UI with library and Settings navigation
* `src/front/viewer-main.tsx`: dedicated PDF viewer entry
* `src/server/index.ts`: one Express process, one PostgreSQL pool, and all routes
* `src/server/services/settingsStore.ts`: AI server and pgvector settings persistence
* `docker/`: one runtime image with PostgreSQL, pgvector, and text search extensions

The service and viewer remain separate browser entrypoints but share one app package, one image, one port, and one data root.

## Forbidden structures

* `apps/free` or `apps/pro` deployable app modules
* `pdfit-free` or `pdfit-pro` Compose services
* runtime edition branching
* a second app-specific dist contract
* a separate PostgreSQL container for this application
