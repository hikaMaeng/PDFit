# Architecture

| Path | Contract | Drill-down |
| --- | --- | --- |
| `src/front/main.tsx` | Integrated service UI and Settings composition. | `src/front/main.tsx` |
| `src/front/viewer-main.tsx` | Dedicated viewer browser entry. | `src/front/viewer-main.tsx` |
| `src/server/index.ts` | One Express process and PostgreSQL pool. | `src/server/index.ts` |
| `BOOKMARKS_ROOT` | Writable local bookmark JPEG storage, isolated from the PDF library mount. | `docker-compose.yml` |
| `src/server/routes/settings.ts` | AI server and pgvector settings routes. | `src/server/routes/settings.ts#createSettingsRouter` |
| `src/server/services/settingsStore.ts` | PostgreSQL settings persistence. | `src/server/services/settingsStore.ts#PostgresSettingsStore` |
| `docker/` | Single runtime image and embedded PostgreSQL startup. | `docker/Dockerfile` |
