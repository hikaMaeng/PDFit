# Migration And Data Contract

Shared viewer metadata is stored in PostgreSQL tables:

* `reading_progress`
* `tags`
* `book_tags`
* `viewer_state`

Integrated settings use:

* `ai_servers`
* `ai_server_models`
* `app_settings`

Startup preserves legacy SQLite metadata by migrating the database found beside `BOOKS_ROOT`. Legacy `pro_settings` rows are copied into `app_settings` when present.

The host library is read-only from the application perspective unless a user explicitly uploads or creates content through the UI. Bind visibility must be verified inside Docker, not inferred from the Windows drive mapping.
