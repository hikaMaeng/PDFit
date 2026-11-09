# Workspace Overview

PDFit is a monorepo for the authenticated service, its shared package, and an opt-in legacy NAS runtime.

| Location | Role |
| --- | --- |
| `packages/pdfit` | Shared viewer, server, types, PostgreSQL metadata, and PDFGPU code |
| `apps/service` | Canonical authenticated service UI/server used by local port 15201 and diagnostic port 15202 |
| `apps/pdfit` | Legacy NAS-only standalone runtime, available explicitly on port 15203 |
| `docker-compose.yml` | Single orchestration entrypoint for canonical service and optional standalone profile |

The default Compose deployment runs the service module. Because 15201 and 15202
bind the same container, account, billing, logout, and Drive behavior are byte-identical.
