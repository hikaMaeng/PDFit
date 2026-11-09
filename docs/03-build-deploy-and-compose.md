# Build, Deploy, And Compose

| Surface | Path | Compose service | Host ports |
| --- | --- | --- | --- |
| Standalone NAS app (Free) | `apps/pdfit/dist` | `pdfit` (profile `standalone`) | `127.0.0.1` and `${PDFIT_LAN_BIND_ADDRESS}` on `${PDFIT_STANDALONE_PORT:-15203}` |
| Hosted service (Pro) | `apps/service/dist` | `service` | `127.0.0.1:15201`, `127.0.0.1:15202` |
| LAN redirect (Pro) | `apps/service/docker` | `service-lan` | `192.168.0.5:15202` |

## Commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Sync PDFGPU, check the release contract, and build every workspace |
| `npm run deploy:standalone` | Build the Free app, recreate only `pdfit`, and refresh the library index |
| `npm run deploy` | Alias of `deploy:service` (private checkout only) |
| `npm run deploy:service` | Build locally and recreate the hosted `service` container |
| `npm run verify:service-parity` | Check hosted-service alignment with the Docker PDFit release |
| `npm run verify:repo` | Repository and Compose contract checks, including service parity |
| `npm run verify:pdfit` | Integrated artifact, UI, Settings API, and viewer checks |

`deploy:service`, `verify:service-parity`, and therefore `verify:repo` need the
private `apps/service` and `packages/service_domain` checkouts at their current
`origin/main`. A stale private checkout fails parity (for example, a service
version that differs from the Docker PDFit version).

`deploy:standalone` removes and recreates only the `pdfit` container. It never
passes `-v`, so `/app/data` (PostgreSQL in `/app/data/pgvector`, bookmarks) and
the library volume are kept. Back up with `pg_dump` inside the container before a
version change.

Compose uses the module-owned `apps/pdfit/docker/Dockerfile` for `pdfit`.

## Standalone LAN address

The `pdfit` service binds `127.0.0.1` and `PDFIT_LAN_BIND_ADDRESS` (default
`192.168.0.5`). Docker refuses to start when that address is not assigned to the
host, so set it in the local `.env` to this host's IPv4 address (see `ipconfig`).

## Library volume

The `pdfit` service mounts the external Docker volume named by
`PDFIT_BOOKS_VOLUME` (default `pdfit-usbshare1`) at `/app/data/books`, and sets
`BOOKS_ROOT=/app/data/books/${PDFIT_BOOKS_SUBPATH}`. `npm run deploy:standalone`
runs `scripts/ensure-docker-library-volume.mjs` to prepare that volume, and
`scripts/refresh-pdfit-library.mjs` (port from `PDFIT_STANDALONE_PORT`) to index it.

When the library is an SMB share, this Docker volume is the bridge between the remote share and the WSL-based Docker engine. Credentials remain in Docker's volume configuration and the local `.env`, and are not stored in the repository. The application treats the configured subpath as the real library root: root PDFs are indexed immediately, and folder creation, upload, move, and deletion operate on the mounted source.

Bookmark JPEG assets are stored at `PDFIT_BOOKMARKS_PATH` (default
`apps/pdfit/docker/volumes/data/bookmarks`), mounted at `/app/data/bookmarks`.

Use the repository deploy commands; do not run a bare `docker compose up -d`.
