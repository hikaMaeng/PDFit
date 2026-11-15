# Library volume offline behaviour

The library volume (SMB/NAS mounted at `BOOKS_ROOT`) can be unreachable. A dead mount does not fail
fast: a synchronous `existsSync`/`readdirSync` on it blocks the Node event loop for 30 s or more, and
every other request waits behind it.

## Contract

- Request paths that list the library (`GET /api/folders`, tags, search, counts) are answered from
  PostgreSQL only and never touch the volume.
- `GET /api/folders` returns folders and counts from the `books` table, colors from `folders`, and the
  root folder from `filesystem.rootFolderName`. Folders that exist on disk but hold no indexed PDF come
  from `diskFolders`, a cache in `createFoldersRouter`.
  - key: folder name; scope: one router; bound: directories directly under the root;
    replaced on each successful read, kept while the volume is unreachable.
  - refreshed by `refreshDiskFolders()` at most every 30 s, never awaited by a request, with one read in
    flight at a time (a hung mount holds at most one worker thread).
- `FilesystemService.listChildFolderNames()` is the asynchronous read; `listFolderShells()` is synchronous
  and must not be used on a request path.
- `POST /api/folders/refresh` (`watcher.refresh`) reads the volume with `fs.promises`. An unreachable root
  rejects before `syncBooks`, so an offline volume is never indexed as an empty library.
- `watcher.start()` probes the root asynchronously, so boot does not stall on an offline volume.

## Check

`node --test packages/pdfit/tests/folders-offline-volume.test.mjs` serves the folder list from a filesystem whose
directory read hangs forever or fails, and asserts a 200 under 1 s with database data only.
