# Runtime Contract

The application runs as the Docker container named `pdfit`.

The image is based on `pgvector/pgvector:pg17` and copies the prebuilt
`apps/pdfit/dist` artifact. The Dockerfile does not build the project.

The container exposes `15201`, serves `/` and `/viewer`, and stores runtime state
under `/app/data`.

Health is provided at `GET /health`. The Compose service uses `init: true` and `restart: unless-stopped`.
