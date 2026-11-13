# Usage

```text
npm run build
npm run deploy:standalone
npm run verify:pdfit
```

## npm installation

Requirements: Node.js 20 or newer with npm, and Docker Desktop (or Docker Engine) with Compose. Install the released launcher from GitHub:

```bash
npm install https://github.com/hikaMaeng/PDFit.git#v0.4.7
npx pdfit
```

The launcher checks Docker, asks for the host folder containing PDFs, runs the official build/Compose deployment, mounts that folder at `/app/data/books`, and opens `http://127.0.0.1:15203` (`PDFIT_STANDALONE_PORT`) with the platform browser launcher; `--no-open` skips the browser. It supports Windows, macOS, and Linux. Pass a folder as `npx pdfit /path/to/pdfs` to skip the prompt. Replace `v0.4.7` with another release tag when needed; `npx pdfit --help` shows the syntax.

The launcher runs `npm run deploy:standalone` with `PDFIT_BOOKS_SOURCE` set to the chosen folder (a bind mount instead of the external NAS volume) and `PDFIT_BOOKS_SUBPATH` empty. It binds the LAN port to `PDFIT_LAN_BIND_ADDRESS` from the shell or `.env`, or else to the first private IPv4 address of the host (`192.168.*`, then `10.*`, then `172.16-31.*`).

For source development, clone the repository, run `npm install`, set `PDFIT_LAN_BIND_ADDRESS` in `.env` to this host's IPv4 address, and then use `npm run deploy:standalone` from the repository root.

Open `http://127.0.0.1:15203` (or `PDFIT_STANDALONE_PORT`). The selected host folder is mounted at `/app/data/books` and is the library root, so PDFs already in that directory are visible immediately; folders created in PDFit are real directories below the mounted root.

Use `/settings` for AI server configuration; the database is embedded in the image and has no settings. The URL is the OpenAI-compatible base that ends before `/chat/completions`, so an LM Studio or apibond server on port 18180 is entered as `http://<host>:18180/v1`. The server calls it from inside the container, so a server running on the Docker host is reachable as `host.docker.internal` or the LAN address, never `127.0.0.1`. Display-name translation waits up to 300 s for a reply, because a local reasoning model can take minutes. The browser merges identical labels and sends at most 50 labels per request, one request at a time. It never asks for labels already written in the target language's script (Hangul for Korean, plain ASCII for English). A cover grid of hundreds of books therefore makes a handful of requests, not one per tag chip. Automatic tag classification uses the same first server with an LLM model, also with a 300 s limit. It gives the model the matched YES24 book's description, table of contents and genre path, and falls back to the YES24 genre rule when the model is unavailable or answers outside the category list. The globe icon at the upper left opens the language and light/dark dialog. Use `/viewer` for the dedicated viewer entry.

## Cover view

A folder page lists its PDFs in Unicode order of the filename (code points after NFC; `compareUnicode` in `packages/pdfit/src/shared/unicodeOrder.ts`), the same in the list and the cover view: digits, Latin capitals, lowercase, then Hangul. Folder and tag pages have a list/cover toggle at the right of the toolbar. The cover view shows a card grid with each PDF's first page, title, tags (on a tag page too, including that page's own tag), last-opened time, size, and the same actions as the list. Covers are JPEGs rendered by the server, not by the browser: an hourly background task renders the first page of every PDF that has no thumbnail for its current modification time and size, and stores it under `/app/data/thumbnails`. A card whose cover is not rendered yet shows "Preparing cover…"; opening the view moves the visible covers to the front of the queue. The chosen view is stored per browser in `localStorage` key `pdfit.library.view`.

The image-search button under a cover ("Use a real book cover") replaces the rendered first page with the real book's cover. The dialog searches YES24 and Open Library for the filename without `.pdf`. The title can be edited and searched again. Candidates are ordered by title match. Clicking one downloads it and shows it on every card for that file. "Restore first page" brings back the rendered page. The chosen cover survives edits to the PDF and follows the file when it is moved; deleting the file deletes it. Another open tab picks up a changed cover when it becomes visible again.

## Clip and page text (OCR)

A saved clip is read in the background. The text comes from the PDF itself when the clip covers real text. Many scanned books carry an invisible OCR layer added by whoever scanned them; when that layer looks damaged (split words such as "pr i ntf", stray ideographs, "댜" for "다."), it is not used. Then, or when there is no text, the Settings AI server reads the clip area rendered again from the PDF at up to 4x (about 1600 px for a column-wide clip): the first server with a `vision` model, else the first with an `llm` model. In **My clips** the card shows a badge while the text is being read, once it is ready, and when it could not be read. In the clip's dialog, **Show text** opens a text pane beside the clip (under it on a narrow screen) with the selectable text, its source ("From the PDF text" or "Read by AI"), a copy button and "Read again". A clip saved before OCR existed has no text yet; the pane offers **Read text**, which queues it (`POST /api/bookmarks/:id/ocr`). The page re-reads the list every 5 s while a clip is still being read, for up to 5 minutes.

In the viewer, the text button in the header ("Read page text") reads the page on screen the same way. A digital page answers at once. A scanned page goes to the AI server and can take minutes; the dialog says so after 4 s. Results are kept per page until the PDF changes, so asking again is instant. Closing the dialog stops waiting, but the server still finishes and keeps the result. A request that does not reach the server at all — the runtime is restarting, or a reverse proxy in front of it answers 502 — is retried for about 30 seconds, so a page read across a restart recovers on its own; only then does the dialog say the server could not be reached. Without an AI server, areas without PDF text show a hint to add one in Settings. Both features exist for local library files only.

## Background tasks

The standalone server runs periodic jobs on one shared schedule and one pool of worker
threads. Cover thumbnails are the first job. Each run recomputes what is missing or
out of date, replaces whatever was still waiting from the previous run, and works
through it with a fixed number of workers. Page text for OCR (`page-text`) is the second job; it plans only clips left pending by a restart and pages a reader is waiting for.

| Variable | Default | Effect |
| --- | --- | --- |
| `PDFIT_TASK_INTERVAL_MINUTES` | `60` | Minutes between runs (1 to 1440) |
| `PDFIT_TASK_CONCURRENCY` | `2` | Worker threads shared by all jobs (1 to 16) |
| `PDFIT_TASK_INITIAL_DELAY_SECONDS` | `30` | Delay before the first run after startup |
| `PDFIT_TASK_COOLDOWN_MS` | `0` | Pause after each task before its worker takes the next |
| `THUMBNAILS_ROOT` | `/app/data/thumbnails` | Where cover JPEGs are stored |

`GET /api/tasks/status` shows the queue, what the last run planned, and recent
failures. Deleting the thumbnails folder is safe; the next run renders it again.
