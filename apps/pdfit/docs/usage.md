# Usage

```text
npm run build
npm run deploy:standalone
npm run verify:pdfit
```

## npm installation

Requirements: Node.js 20 or newer with npm, and Docker Desktop (or Docker Engine) with Compose. Install the released launcher from GitHub:

```bash
npm install https://github.com/hikaMaeng/PDFit.git#v0.4.6
npx pdfit
```

The launcher checks Docker, asks for the host folder containing PDFs, runs the official build/Compose deployment, mounts that folder at `/app/data/books`, and opens `http://127.0.0.1:15203` (`PDFIT_STANDALONE_PORT`) with the platform browser launcher; `--no-open` skips the browser. It supports Windows, macOS, and Linux. Pass a folder as `npx pdfit /path/to/pdfs` to skip the prompt. Replace `v0.4.6` with another release tag when needed; `npx pdfit --help` shows the syntax.

The launcher runs `npm run deploy:standalone` with `PDFIT_BOOKS_SOURCE` set to the chosen folder (a bind mount instead of the external NAS volume) and `PDFIT_BOOKS_SUBPATH` empty. It binds the LAN port to `PDFIT_LAN_BIND_ADDRESS` from the shell or `.env`, or else to the first private IPv4 address of the host (`192.168.*`, then `10.*`, then `172.16-31.*`).

For source development, clone the repository, run `npm install`, set `PDFIT_LAN_BIND_ADDRESS` in `.env` to this host's IPv4 address, and then use `npm run deploy:standalone` from the repository root.

Open `http://127.0.0.1:15203` (or `PDFIT_STANDALONE_PORT`). The selected host folder is mounted at `/app/data/books` and is the library root, so PDFs already in that directory are visible immediately; folders created in PDFit are real directories below the mounted root.

Use `/settings` for AI server configuration; the database is embedded in the image and has no settings. The URL is the OpenAI-compatible base that ends before `/chat/completions`, so an LM Studio or apibond server on port 18180 is entered as `http://<host>:18180/v1`. The server calls it from inside the container, so a server running on the Docker host is reachable as `host.docker.internal` or the LAN address, never `127.0.0.1`. Display-name translation waits up to 300 s for a reply, because a local reasoning model can take minutes. The globe icon at the upper left opens the language and light/dark dialog. Use `/viewer` for the dedicated viewer entry.

## Cover view

Folder and tag pages have a list/cover toggle at the right of the toolbar. The cover view shows a card grid with each PDF's first page, title, tags, last-opened time, size, and the same actions as the list. Covers are JPEGs rendered by the server, not by the browser: an hourly background task renders the first page of every PDF that has no thumbnail for its current modification time and size, and stores it under `/app/data/thumbnails`. A card whose cover is not rendered yet shows "Preparing cover…"; opening the view moves the visible covers to the front of the queue. The chosen view is stored per browser in `localStorage` key `pdfit.library.view`.

## Background tasks

The standalone server runs periodic jobs on one shared schedule and one pool of worker
threads. Cover thumbnails are the first job. Each run recomputes what is missing or
out of date, replaces whatever was still waiting from the previous run, and works
through it with a fixed number of workers.

| Variable | Default | Effect |
| --- | --- | --- |
| `PDFIT_TASK_INTERVAL_MINUTES` | `60` | Minutes between runs (1 to 1440) |
| `PDFIT_TASK_CONCURRENCY` | `2` | Worker threads shared by all jobs (1 to 16) |
| `PDFIT_TASK_INITIAL_DELAY_SECONDS` | `30` | Delay before the first run after startup |
| `PDFIT_TASK_COOLDOWN_MS` | `0` | Pause after each task before its worker takes the next |
| `THUMBNAILS_ROOT` | `/app/data/thumbnails` | Where cover JPEGs are stored |

`GET /api/tasks/status` shows the queue, what the last run planned, and recent
failures. Deleting the thumbnails folder is safe; the next run renders it again.
