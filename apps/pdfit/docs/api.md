# API

## Browser routes

* `/` — library service UI
* `/settings` — AI server settings UI (no database settings: the image embeds PostgreSQL)
* `/viewer` — dedicated PDF viewer UI
* `/tag-index` — tag "Index" page: one masonry card per tag listing its book titles

## Server routes

* `/health` — runtime health
* `/api/folders`, `/api/tags`, `/api/progress`, `/api/viewer-state`, `/api/events` — shared library APIs
* `/api/tags/summary` — tag names with the number of books using each tag
* `GET /api/tags/index` — every tag with all of its books (`[{ name, color, books: [{ folder, filename }] }]`), for the sidebar "Index" page; `501` when the metadata store does not implement it
* `GET /api/tags/untagged-books`, `GET /api/tags/untagged-count` — books that have no tag at all (sidebar "Untagged"); `501` when the metadata store does not implement them
* `DELETE /api/tags/:tag` — removes a tag and its association from every book
* `GET /api/search/books?q=` — book title search against the metadata database (substring, titles only)
* `/api/covers` — real-book covers: `GET` list, `GET /candidates?q=`, `GET /preview?url=`, `PUT` apply, `DELETE` restore (contract in `packages/pdfit/docs/api.md`)
* `POST /api/ocr/page` — text of one page: PDF text layer, else the Settings vision model on a rendering; cached per file state
* `POST /api/bookmarks/:id/ocr` — read a clip's text again; clips are read automatically after they are saved (contract in `packages/pdfit/docs/api.md`, "OCR")
* `/api/settings/ai-servers` — AI server CRUD
* `POST /api/settings/translations` — display-name translation through the first AI server that has an `llm` model; the upstream chat-completions call aborts after 300 s (reasoning models on a local server can take minutes)

The shared route factories are exported by `@pdfit/pdfit/server`; app-owned settings are wired in `src/server/index.ts`.
