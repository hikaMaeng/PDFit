# API

## Browser routes

* `/` — library service UI
* `/settings` — AI server settings UI (no database settings: the image embeds PostgreSQL)
* `/viewer` — dedicated PDF viewer UI

## Server routes

* `/health` — runtime health
* `/api/folders`, `/api/tags`, `/api/progress`, `/api/viewer-state`, `/api/events` — shared library APIs
* `/api/tags/summary` — tag names with the number of books using each tag
* `GET /api/tags/untagged-books`, `GET /api/tags/untagged-count` — books that have no tag at all (sidebar "Untagged"); `501` when the metadata store does not implement them
* `DELETE /api/tags/:tag` — removes a tag and its association from every book
* `GET /api/search/books?q=` — book title search against the metadata database (substring, titles only)
* `/api/settings/ai-servers` — AI server CRUD

The shared route factories are exported by `@pdfit/pdfit/server`; app-owned settings are wired in `src/server/index.ts`.
