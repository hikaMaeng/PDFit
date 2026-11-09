# Runtime Contract

The application runs as the Compose service `pdfit`. Compose names the
container `<project>-pdfit-1`; with the default project name from the repository
folder, this is `pdfit-pdfit-1`.

The image is based on `pgvector/pgvector:pg17` and copies the prebuilt
`apps/pdfit/dist` artifact. The Dockerfile does not build the project.

The container publishes `15201` on all host interfaces, serves `/` and `/viewer`,
and stores runtime state under `/app/data`. The local app has no login; restrict
host network access if other machines must not reach it.

Health is provided at `GET /health`. The Compose service uses `init: true` and `restart: unless-stopped`.
