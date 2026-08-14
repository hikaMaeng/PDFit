# Workspace Overview

PDFit is a monorepo for the public local-library app and its shared package.

| Location | Role |
| --- | --- |
| `packages/pdfit` | Shared viewer, server, types, PostgreSQL metadata, and PDFGPU code |
| `apps/pdfit` | Integrated service/viewer entrypoints, settings, Docker image, docs, and tests |
| `docker-compose.yml` | The local `pdfit` runtime service on port 15201 |

The public checkout does not contain or require account, billing, or remote
Drive service code.
