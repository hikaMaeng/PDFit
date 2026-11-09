# Workspace Overview

PDFit is a monorepo for the public local-library app and its shared package.

| Location | Role | Public repo |
| --- | --- | --- |
| `packages/pdfit` | Shared viewer, server, types, PostgreSQL metadata, remote-library router, and PDFGPU code | Yes |
| `apps/pdfit` | Integrated local-library service/viewer entrypoints, settings, Docker image, docs, and tests | Yes |
| `docker-compose.yml` | Root Compose entry; the public runtime is the `pdfit` service on port 15201 | Yes |
| `apps/service`, `packages/service_domain` | Hosted edition, kept in separate private repositories | No (ignored) |

The public checkout does not contain account, billing, or remote Drive service
source code. Running and deploying the public `pdfit` service does not require it.

Maintainer-only commands read the private checkouts and fail without them:
`npm run deploy:service`, `npm run test:service`, `npm run verify:service-parity`,
and `npm run verify:repo` (which runs the parity check).
