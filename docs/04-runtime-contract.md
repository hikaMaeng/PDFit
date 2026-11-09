# Runtime Contract

The standalone application runs as the Compose service `pdfit` under the
`standalone` profile. Compose names the container `<project>-pdfit-1`; with the
default project name from the repository folder, this is `pdfit-pdfit-1`.

The image is based on `pgvector/pgvector:pg17` and copies the prebuilt
`apps/pdfit/dist` artifact. The Dockerfile does not build the project.

The container listens on `15201` internally. Compose publishes it on
`127.0.0.1` and `PDFIT_LAN_BIND_ADDRESS`, port `PDFIT_STANDALONE_PORT`
(default `15203`). Host port `15201` belongs to the hosted `service` container.
The app serves `/` and `/viewer` and stores runtime state under `/app/data`. The
local app has no login; anyone who can reach the LAN address can use it.

Health is provided at `GET /health`. The Compose service uses `init: true` and `restart: unless-stopped`.
