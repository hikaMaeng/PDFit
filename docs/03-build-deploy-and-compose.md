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
| `npm run verify:repo` | Repository and Compose contract checks, including service parity |
| `npm run verify:pdfit` | Integrated artifact, UI, Settings API, and viewer checks |

`deploy:service`, `verify:service-parity`, and therefore `verify:repo` need the
private `apps/service` and `packages/service_domain` checkouts at their current
`origin/main`. A stale private checkout fails parity (for example, a service
version that differs from the Docker PDFit version).

Compose uses the module-owned `apps/pdfit/docker/Dockerfile` for `pdfit`.

## Library volume

The `pdfit` service mounts the external Docker volume named by
`PDFIT_BOOKS_VOLUME` (default `pdfit-usbshare1`) at `/app/data/books`, and sets
`BOOKS_ROOT=/app/data/books/${PDFIT_BOOKS_SUBPATH}`. `npm run deploy` runs
`scripts/ensure-docker-library-volume.mjs` to prepare that volume.

When the library is an SMB share, this Docker volume is the bridge between the remote share and the WSL-based Docker engine. Credentials remain in Docker's volume configuration and the local `.env`, and are not stored in the repository. The application treats the configured subpath as the real library root: root PDFs are indexed immediately, and folder creation, upload, move, and deletion operate on the mounted source.

Bookmark JPEG assets are stored at `PDFIT_BOOKMARKS_PATH` (default
`apps/pdfit/docker/volumes/data/bookmarks`), mounted at `/app/data/bookmarks`.

Use the repository deploy command; do not run a bare `docker compose up -d`.
