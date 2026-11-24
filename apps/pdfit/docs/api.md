# API

## Browser routes

* `/` — library service UI
* `/settings` — AI server settings UI (no database settings: the image embeds PostgreSQL)
* `/viewer` — dedicated PDF viewer UI
* `/tag-index` — tag "Index" page: one masonry card per tag listing its book titles

## Server routes

* `/health` — runtime health
* `/api/folders`, `/api/tags`, `/api/progress`, `/api/viewer-state`, `/api/events` — shared library APIs
* `POST /api/folders/:name/files` receives multipart PDFs. Each completed file is moved into the library, and the upload succeeds after its records are committed to PostgreSQL. The response contains `name`, `size`, and `modifiedAt`. The full scan runs separately, and the commit emits `folders-changed` and `tags-changed` on `/api/events`. See [upload route](../../../packages/pdfit/src/server/routes/folders.ts) and [index commit and scan](../../../packages/pdfit/src/server/services/watcher.ts).
* `/api/tags/summary` — tag names with the number of books using each tag
* `GET /api/tags/index` — every tag with all of its books (`[{ name, color, books: [{ folder, filename }] }]`), for the sidebar "Index" page; `501` when the metadata store does not implement it
* `GET /api/tags/untagged-books`, `GET /api/tags/untagged-count` — books that have no tag at all (sidebar "Untagged"); `501` when the metadata store does not implement them
* `GET /api/favorites` (`[{ folder, filename }]`), `GET /api/favorites/books` (full records with tags), `PUT|DELETE /api/favorites/:folder/:filename` — favorite marks (sidebar "Favorites", the star on every card and row). Database only: a book that is not in `books` cannot be marked, and `PUT/DELETE` answer `{ ok, favorite }`. A change is announced as the `favorites-changed` event on `/api/events`; `501` when the metadata store does not implement favorites, and the UI then hides the star and the sidebar entry
* `GET /api/tag-folders` returns `[{ id, name, color, tags }]` in sidebar order. `POST /api/tag-folders` creates a folder from `{ name }` and returns `201`. Names are trimmed and normalized to NFC, up to 100 characters. Invalid names return `400` and duplicates return `409`.
* `PATCH /api/tag-folders/:id/details` accepts `{ name?, color? }`. Color accepts `#RRGGBB` or `null` for the theme default. A rename preserves the folder ID and tag memberships.
* `POST /api/tag-folders/:id/move` accepts `{ direction: "up" | "down", neighborId }`, swaps adjacent folders, and saves the order. Both ID-based routes return `204` on success, `400` for invalid input, and `404` for a missing folder. Edits return `409` for duplicate names, and moves return `409` when the expected neighbor has changed.
* `DELETE /api/tag-folders/:name` removes a folder and its memberships. `PUT|DELETE /api/tag-folders/:name/tags/:tag` changes membership. `PUT` returns `404` for an unknown folder or tag. A tag can belong to several folders. Folder deletion preserves the tags, and tag deletion removes all its memberships.
* Tag folder changes emit `tag-folders-changed` on `/api/events`. The shared router returns `501` when the relevant store operation is unsupported. [Routes](../../../packages/pdfit/src/server/routes/tagFolders.ts#createTagFoldersRouter) · [Protocol](../../../packages/pdfit/src/common/protocol/tagFolders/index.ts)
* `DELETE /api/tags/:tag` — removes a tag and its association from every book
* `GET /api/search/books?q=` — book title search against the metadata database (substring, titles only)
* `GET /api/search/content/:scope?q=` — indexed text for one scope (`outline`, `page-ocr`, `clip-ocr`, `clip-memo`). See the [search and index contract](../../../packages/pdfit/docs/content-search.md).
* `/api/covers` — real-book covers: `GET` list, `GET /candidates?q=`, `GET /preview?url=`, `PUT` apply, `DELETE` restore (contract in `packages/pdfit/docs/api.md`)
* `POST /api/ocr/page` — text of one page: PDF text layer, else the Settings vision model on a rendering; cached per file state
* `POST /api/bookmarks/:id/ocr` — read a clip's text again; clips are read automatically after they are saved (contract in `packages/pdfit/docs/api.md`, "OCR")
* `/api/settings/ai-servers` — AI server CRUD
* `POST /api/settings/translations` — display-name translation through the first AI server that has an `llm` model; the upstream chat-completions call aborts after 300 s (reasoning models on a local server can take minutes)

The shared route factories are exported by `@pdfit/pdfit/server`; app-owned settings are wired in `src/server/index.ts`.
