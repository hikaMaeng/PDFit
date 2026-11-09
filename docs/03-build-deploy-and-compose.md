# Build, Deploy, And Compose

| Surface | Path | Service | Port |
| --- | --- | --- | --- |
| Integrated app | `apps/pdfit/dist` | `pdfit` | `15201` |
| Hosted service | `apps/service/dist` | `service` | `15202` |

## Commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Build the shared package and integrated app |
| `npm run deploy` | Build locally, recreate `pdfit`, and verify health |
| `npm run deploy:service` | Build locally and recreate the hosted `service` container |
| `npm run verify:service-parity` | Check hosted-service alignment with the Docker PDFit release |
| `npm run verify:repo` | Repository and Compose contract checks |
| `npm run verify:pdfit` | Integrated artifact, UI, Settings API, and viewer checks |

Compose uses the module-owned `apps/pdfit/docker/Dockerfile`. The `pdfit`
service keeps its host library bind contract.

This Docker volume is the bridge between the remote SMB share and the WSL-based Docker engine. Credentials remain in Docker's volume configuration and are not stored in the repository. The application treats the configured subpath as the real library root: root PDFs are indexed immediately, and folder creation, upload, move, and deletion operate on the mounted source.

Use the repository deploy command; do not run a bare `docker compose up -d`.
