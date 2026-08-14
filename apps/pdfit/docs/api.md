# API

## Browser routes

* `/` — library service UI
* `/settings` — AI server and pgvector settings UI
* `/viewer` — dedicated PDF viewer UI

## Server routes

* `/health` — runtime health
* `/api/folders`, `/api/tags`, `/api/progress`, `/api/viewer-state`, `/api/events` — shared library APIs
* `/api/tags/summary` — tag names with the number of books using each tag
* `DELETE /api/tags/:tag` — removes a tag and its association from every book
* `/api/settings/ai-servers` — AI server CRUD
* `/api/settings/pgvector` — pgvector settings read/write

The shared route factories are exported by `@pdfit/pdfit/server`; app-owned settings are wired in `src/server/index.ts`.
