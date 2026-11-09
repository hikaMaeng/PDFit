# Workspace Overview

PDFit is a monorepo for the public local-library app and its shared package. Maintainer workspaces can also include the authenticated hosted edition.

| Location | Role | Public repo |
| --- | --- | --- |
| `packages/pdfit` | Shared viewer, server, types, PostgreSQL metadata, remote-library router, and PDFGPU code | Yes |
| `apps/pdfit` | Standalone NAS service and viewer entrypoints, settings, Docker image, docs, and tests | Yes |
| `docker-compose.yml` | Root orchestration for the hosted service and opt-in standalone runtime | Yes |
| `apps/service`, `packages/service_domain` | Hosted edition, kept in separate private repositories | No (ignored) |

From a public checkout, target the standalone service explicitly with
`docker compose --profile standalone up -d --build pdfit`. Its default host port
is 15203. The default Compose services in a maintainer checkout require the
private modules. Loopback ports 15201 and 15202 route to the same authenticated
service container.

Maintainer-only commands read the private checkouts and fail without them.
These include `npm run deploy:service`, `npm run test:service`,
`npm run verify:service-parity`, and `npm run verify:repo`.
