# Usage

```text
npm run build
npm run deploy:standalone
npm run verify:pdfit
```

## Home and library tools

On the [home page](../../../packages/pdfit/src/front/pages/HomePage.tsx), open
the library or browse by topic through the tag index. Use **Untagged** to review
documents that still need classification, and **Favorites** for frequent reads.
The **Set up AI servers** link opens Settings for the language and vision
models used by auto-tagging, display-name translation, and scan OCR. **View
bookmarks** opens the library-wide clip collection.

## npm installation

Requirements: Node.js 20 or newer with npm, and Docker Desktop (or Docker Engine) with Compose. Install the released launcher from GitHub:

```bash
npm install https://github.com/hikaMaeng/PDFit.git#v0.4.8
npx pdfit
```

The launcher checks Docker, asks for the host folder containing PDFs, runs the official build/Compose deployment, mounts that folder at `/app/data/books`, and opens `http://127.0.0.1:15203` (`PDFIT_STANDALONE_PORT`) with the platform browser launcher; `--no-open` skips the browser. It supports Windows, macOS, and Linux. Pass a folder as `npx pdfit /path/to/pdfs` to skip the prompt. Replace `v0.4.8` with another release tag when needed; `npx pdfit --help` shows the syntax.

The launcher runs `npm run deploy:standalone` with `PDFIT_BOOKS_SOURCE` set to the chosen folder (a bind mount instead of the external NAS volume) and `PDFIT_BOOKS_SUBPATH` empty. It binds the LAN port to `PDFIT_LAN_BIND_ADDRESS` from the shell or `.env`, or else to the first private IPv4 address of the host (`192.168.*`, then `10.*`, then `172.16-31.*`).

For source development, clone the repository, run `npm install`, set `PDFIT_LAN_BIND_ADDRESS` in `.env` to this host's IPv4 address, and then use `npm run deploy:standalone` from the repository root.

Open `http://127.0.0.1:15203` (or `PDFIT_STANDALONE_PORT`). The selected host folder is mounted at `/app/data/books` and is the library root, so PDFs already in that directory are visible immediately; folders created in PDFit are real directories below the mounted root.

Use `/settings` for AI server configuration; the database is embedded in the image and has no settings. The URL is the OpenAI-compatible base that ends before `/chat/completions`, so an LM Studio or apibond server on port 18180 is entered as `http://<host>:18180/v1`. The server calls it from inside the container, so a server running on the Docker host is reachable as `host.docker.internal` or the LAN address, never `127.0.0.1`. Display-name translation waits up to 300 s for a reply, because a local reasoning model can take minutes. The browser merges identical labels and sends at most 50 labels per request, one request at a time. It never asks for labels already written in the target language's script (Hangul for Korean, plain ASCII for English). A cover grid of hundreds of books therefore makes a handful of requests, not one per tag chip. Automatic tag classification uses the same first server with an LLM model, also with a 300 s limit. It gives the model the matched YES24 book's description, table of contents and genre path, and falls back to the YES24 genre rule when the model is unavailable or answers outside the category list. The globe icon at the upper left opens the language and light/dark dialog. Use `/viewer` for the dedicated viewer entry.

## Tag folders

Drag a tag onto the folder title or anywhere in its expanded body, including the empty area and existing tag rows. An ungrouped tag has a **Move to tag folder** button beside **Delete tag**. Open the folder menu and pick a destination. The tag appears inside that folder and leaves the ungrouped list. Use **Remove from tag folder** to remove a membership.

## Cover view

Drag a book's cover or title onto a tag in the left sidebar to add that tag to the book. You can also start the drag while the card's details are open.

A folder page lists its PDFs in Unicode order of the filename (code points after NFC; `compareUnicode` in `packages/pdfit/src/shared/unicodeOrder.ts`), the same in the list and the cover view: digits, Latin capitals, lowercase, then Hangul. Folder and tag pages have a list/cover toggle at the right of the toolbar. The cover view shows a card grid with each PDF's first page, title, tags (on a tag page too, including that page's own tag), last-opened time, size, and the same actions as the list. Covers are JPEGs rendered by the server, not by the browser: an hourly background task renders the first page of every PDF that has no thumbnail for its current modification time and size, and stores it under `/app/data/thumbnails`. A card whose cover is not rendered yet shows "Preparing cover…"; opening the view moves the visible covers to the front of the queue. The chosen view is stored per browser in `localStorage` key `pdfit.library.view`.

The image-search button under a cover ("Use a real book cover") replaces the rendered first page with the real book's cover. The dialog searches YES24 and Open Library for the filename without `.pdf`. The title can be edited and searched again. Candidates are ordered by title match. Clicking one downloads it and shows it on every card for that file. "Restore first page" brings back the rendered page. The chosen cover survives edits to the PDF and follows the file when it is moved; deleting the file deletes it. Another open tab picks up a changed cover when it becomes visible again.

## Viewer toolbar

Open a document with `engine=gpu` in the viewer URL to enable PDFium's progressive preview cache. The default viewer uses PDF.js with HTTP range loading.

The toolbar below the document title uses small English captions under its icons in both the PDF.js and GPU viewers. On narrow screens, groups of controls wrap onto additional rows. Use **OCR** to read the current page of a local PDF, or **Download** to save the document. Tooltips and accessible button names follow the interface language.

Open **Image** for live page color adjustments. Choose **Night**, **Grayscale**, or **High contrast**, or use the invert switch and the brightness, contrast, and saturation sliders. **Reset** restores the original display. Inversion is saved with the book's reading position. The other adjustments last for the current viewer session. Downloads and clips use the original PDF colors.

## Table of contents

The contents button in the viewer toolbar opens the book's table of contents. It uses a usable embedded PDF outline first. If the outline is missing or has only scan-volume labels such as `1` and `2`, PDFit looks for the book on YES24 using a readable ISBN or the filename's exact title. It matches YES24 entries to PDF page labels, printed page numbers, or headings in the PDF text layer. Entries whose destination cannot be verified show **No page**. Clicking a linked entry goes to that page and closes the dialog.

If the PDF and YES24 yield no usable outline, the dialog shows **Could not load the table of contents**. You can still create a manual outline.

An outline with a verified destination is saved in the database. Later opens use that copy until the PDF is replaced or the saved outline is changed. **Regenerate** repeats the PDF and YES24 lookup and can replace an older saved numeric outline. **Edit outline** lets you add or remove entries and change titles, page numbers, and levels. **Delete outline** asks for confirmation and keeps the outline empty on later opens.

These actions change the viewer’s outline in the database. If a PDF is replaced, moved, or removed, its saved outline is discarded. Sample books support reading and regenerating the embedded outline during the session.

## Clip and page text (OCR)

A saved clip is read in the background. The text comes from the PDF itself when the clip covers real text. Many scanned books carry an invisible OCR layer added by whoever scanned them; when that layer looks damaged (split words such as "pr i ntf", stray ideographs, "댜" for "다."), it is not used. Then, or when there is no text, the Settings AI server reads the clip area rendered again from the PDF at up to 4x (about 1600 px for a column-wide clip): the first server with a `vision` model, else the first with an `llm` model. In **My clips** the card shows a badge while the text is being read, once it is ready, and when it could not be read. In the clip detail, the header has the book title, page, and buttons for OCR, deletion and opening the page in the viewer. **Show text** opens a separate dialog with selectable text, its source, **Copy**, and **Read again**. For a clip saved before OCR existed, **Read text** queues OCR. The collection re-reads its scope every 5 seconds while OCR is pending, for up to 5 minutes.

Open the paperclip beside a cover card's filename to see just that book's clips. Switch between **Date added** and **Page order** above the grid. A clip opens the same detail as **My clips**. Write in **Memo** under the capture and press **Save** to persist the text. **Reset** restores the last saved memo.

In the viewer, **OCR** in the toolbar reads the page on screen the same way. A digital page answers at once. A scanned page goes to the AI server and can take minutes; the dialog says so after 4 s. Results are kept per page until the PDF changes, so asking again is instant. Closing the dialog stops waiting, but the server still finishes and keeps the result. A request that does not reach the server at all — the runtime is restarting, or a reverse proxy in front of it answers 502 — is retried for about 30 seconds, so a page read across a restart recovers on its own; only then does the dialog say the server could not be reached. Without an AI server, areas without PDF text show a hint to add one in Settings. Both features exist for local library files only.

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
