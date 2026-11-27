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
If the library list fails to load, use **Retry** on the home page to load it again.
The **Set up AI servers** link opens Settings for the language and vision
models used by auto-tagging, display-name translation, and scan OCR. **View
bookmarks** opens the library-wide clip collection.

**Recently added** (신규등록) is fixed at the top of **Folders**. It shows up
to 30 books from across the library, newest registrations first, in list or
cover view. Use **Refresh** to include PDFs copied directly to the library.

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

Use `/settings` for AI server configuration; the database is embedded in the image and has no settings. The URL is the OpenAI-compatible base that ends before `/chat/completions`, so an LM Studio or apibond server on port 18180 is entered as `http://<host>:18180/v1`. The server calls it from inside the container, so a server running on the Docker host is reachable as `host.docker.internal` or the LAN address, never `127.0.0.1`. Display-name translation waits up to 300 s for a reply, because a local reasoning model can take minutes. The browser translates library folder display names. Tags, tag folder names, and PDF filenames appear as saved. The browser merges identical folder names and sends at most 50 labels per request, one request at a time. It skips labels already written in the target language's script (Hangul for Korean, plain ASCII for English). Automatic tag classification uses the same first server with an LLM model, also with a 300 s limit. It gives the model the matched YES24 book's description, table of contents and genre path, and falls back to the YES24 genre rule when the model is unavailable or answers outside the category list. The globe icon at the upper left opens the language and light/dark dialog. Use `/viewer` for the dedicated viewer entry.

## Manage a document's tags

Open **Manage tags** from a PDF card or list row. Pick an autocomplete option to
add it, or enter a new name and press Enter. The options fill four columns from
left to right before continuing on the next row. The three most recently added
tags appear under the input, newest first. Click one to apply it to the current
document. A recent tag you already applied to the document appears disabled.

## Edit a tag

In the sidebar, select a tag or point at its row, then choose the pencil button. The same button is available inside tag folders and on touch screens. Edit the name, choose a color or icon, and save. The tag keeps its PDF links and folder memberships. An existing tag name produces a conflict so you can choose a different name.

## Delete a tag

Use **Delete tag** on the [sidebar tag row](../../../packages/pdfit/src/front/layout/LNB.tsx#confirmDeleteItem) and confirm. If you are still viewing that tag when deletion succeeds, PDFit opens Home. If you have already switched pages, PDFit keeps that page. Documents without tags move into **Untagged**, and its sidebar count refreshes immediately.

## Tag folders

Use the pencil beside a tag folder to change its name or icon color. Use **Default color** to restore the theme color. The up and down arrows swap the folder with its neighbor. The library remembers the order after reload. [Tag folder controls](../../../packages/pdfit/docs/usage.md#tag-folders)

Drag a tag onto the folder title or anywhere in its expanded body, including the empty area and existing tag rows. An ungrouped tag has a **Move to tag folder** button beside **Delete tag**. Open the folder menu and pick a destination. The tag appears inside that folder and leaves the ungrouped list. Use **Remove from tag folder** to remove a membership.

## Cover view

Drag a book's cover or title onto a tag in the left sidebar to add it. You can also drag the grip at the top of a book card with a mouse, finger, or pen. On narrow screens the sidebar opens as you drag. Hold over a collapsed tag folder to open it, then release on the tag. The new tag appears on the book, and a tagged book leaves the Untagged list.

Drag a sidebar tag by its name onto a tag folder's heading or body. On a touchscreen, press and hold the name before dragging. If the tag already belongs to a folder, this adds it to the destination as well.

Hover over a cover or open **Show document info** to find **AI auto tagging** after the book's tags. The button's tooltip and accessible name both use **AI auto tagging** (`AI 자동 태그` in Korean). The three-dot **File actions** menu contains **Rename file**, **Move to another folder**, and **Delete**. A rename changes the PDF's actual filename and keeps its tags, clips, reading state, and comments. If you omit the extension, PDFit adds it.

Select **Comments** at the bottom left of a card to open that book's board. Choose **New comment** to post a memo. Each page shows up to five full posts, newest first. Scroll the body when posts exceed the available height. The heading and page controls stay in view as the window resizes. Each post has its own edit and delete controls. **View bookmarks** in the title row opens the book's separate clip collection.

The card's comment icon shows a gray **0** for an empty board and a yellow count when it has posts. It shows **9+** for ten or more posts. Hover over the icon to see the exact count.

A folder page lists PDFs by filename in Unicode code-point order after NFC normalization. Digits come first, followed by Latin capitals, lowercase, and Hangul. Use the toolbar to switch between list and cover views in folders, tags, and title search. The browser remembers the selected view under `pdfit.library.view`.

In list view, each row starts with the cover. In the filename column, select the star to change favorites or the pencil to rename the PDF. The next line shows each tag with its saved icon, followed by **AI auto tagging** when available and **Manage tags**. The file size is followed by **Comments**, **View bookmarks**, **Use a real book cover** where supported, **Move to another folder**, and **Delete**. On phones, the file actions sit below the filename and file size. The folder toolbar shows the document count and switches between list and cover views. Use the controls on each book to tag, move, or delete it.

Cover view shows a card grid. Open the card's information overlay for the last-opened time and, where supported, document info. Free uses the same server-rendered JPEG in both views. The hourly thumbnail task renders PDFs that need a new thumbnail, stores it in `/app/data/thumbnails`, and prioritizes missing covers requested by visible rows or cards.

**Use a real book cover** replaces the rendered first page with the real book's cover. The dialog searches YES24 and Open Library for the filename without `.pdf`. The title can be edited and searched again. Candidates appear as sources respond and are ordered by title match. Select any displayed candidate to cancel the remaining searches and apply it immediately. If applying fails, the displayed candidates remain available for retry. **Restore first page** brings back the rendered page. The chosen cover survives PDF edits and file moves. Deleting the file deletes its chosen cover. Another open tab picks up a changed cover when it becomes visible again.

## Viewer toolbar

Open a document with `engine=gpu` in the viewer URL to enable PDFium's progressive preview cache. The default viewer uses PDF.js with HTTP range loading.

The toolbar below the document title uses small English captions under its icons in both the PDF.js and GPU viewers. On narrow screens, groups of controls wrap onto additional rows. Use **OCR** to open the text dialog on the current page of a local PDF, or **Download** to save the document. Tooltips and accessible button names follow the interface language.

Select **Comments** in the viewer toolbar to open the book's floating comment window. Drag the title to move it or drag the bottom-right corner to resize it. Both handles support touch and arrow keys. The browser saves each book's window size and position. Use the top-right X or press Escape from inside the window to dismiss it. The book card and viewer share the same posts and images. [Comment attachments and window controls](../../../packages/pdfit/docs/usage.md#book-comments-markdown)

The annotation tool palette and clip list float above the full-width PDF. Use the chevron at the top of the palette to collapse or expand the tools. Drag the grip at the top of the palette or the clip list's title to move that panel. You can also focus either grip and move it with the arrow keys. The browser remembers both positions.

Select **Clips** to open the document's clip list and enable area selection. Drag a rectangle within one page to save a clip. The button turns off when you release a valid selection, and the list stays open. Press the lit **Clips** button again to cancel before selecting, or use **Close** in the list header to dismiss the list.

Open **Image** for live page color adjustments. Choose **Night**, **Grayscale**, or **High contrast**, or use the invert switch and the brightness, contrast, and saturation sliders. **Reset** restores the original display. Inversion is saved with the book's reading position. The other adjustments last for the current viewer session. Downloads and clips use the original PDF colors.

## Viewer popups

Bot, Comments, page OCR, and Contents open as floating popups while the viewer remains usable. Drag the header to move a popup or drag the grip at the lower right to resize it. Use the arrow keys when either handle has focus. Hold Shift for larger steps. Close the popup with the X at the upper right or press Escape while it has focus.

The browser remembers the position and size of each popup for each book. Every popup has a minimum size. If the screen becomes too small, the popup fits the available area and returns to its saved size when there is room again.

## Viewer Bot

Choose **Bot** in the viewer toolbar to open a floating chat for the current book. Ask a question or request a summary. The reply can cite the PDF page number and distinguish your comments from the book's text.

Bot shows its current stage while it prepares context, reads sections, waits for the model, or saves the conversation. Answer text appears as it arrives. Select a page reference such as **p. 9** to jump to that PDF page while keeping the chat open. If a reply fails, send the question again using the draft left in the input.

Bot opens the most recently started chat for this book. **Chat history** shows each saved title and start time. Choose an earlier row to continue that conversation or **New chat** to start another. The title comes from the first completed exchange.

In **Settings → AI Servers**, set an LLM model for chat. The configured AI server receives the question, conversation and relevant book material. Bot reads the saved or embedded contents, scanned page text, saved clips, clip OCR and notes, and book comments. Clip image descriptions use the configured vision model or an LLM that supports images. Use **Scan** to make more page text available.

Set **Bot context limit (tokens)** to the window available on that LLM or gateway. Within the estimated window, Bot sends the book material and conversation directly in one answer request.

See [context and storage](../../../packages/pdfit/docs/book-bot.md).

## Table of contents

The contents button in the viewer toolbar opens the book's table of contents. It uses a usable embedded PDF outline first. If the outline is missing or has only scan-volume labels such as `1` and `2`, PDFit looks for the book on YES24 using a readable ISBN or the filename's exact title. It matches YES24 entries to PDF page labels, printed page numbers, or headings in the PDF text layer. Entries whose destination cannot be verified show **No page**. Clicking a linked entry goes to that page and closes the dialog.

Select the save icon beside a page number to jump there and save the reading position immediately. The dialog closes after the save succeeds. If the save fails, select the icon again to retry. In two-page mode, the saved position is the first page of the spread containing the destination.

If the PDF and YES24 yield no usable outline, the dialog shows **Could not load the table of contents**. You can still create a manual outline.

An outline with a verified destination is saved in the database. Later opens use that copy until the PDF is replaced or the saved outline is changed. **Regenerate** repeats the PDF and YES24 lookup and can replace an older saved numeric outline. **Edit outline** lets you add or remove entries and change titles, page numbers, and levels. **Delete outline** asks for confirmation and keeps the outline empty on later opens.

These actions change the viewer’s outline in the database. If a PDF is replaced, moved, or removed, its saved outline is discarded. Sample books support reading and regenerating the embedded outline during the session.

## Clip and page text (OCR)

A saved clip is read in the background. The text comes from the PDF itself when the clip covers real text. Many scanned books carry an invisible OCR layer added by whoever scanned them; when that layer looks damaged (split words such as "pr i ntf", stray ideographs, "댜" for "다."), it is not used. Then, or when there is no text, the Settings AI server reads the clip area rendered again from the PDF at up to 4x (about 1600 px for a column-wide clip): the first server with a `vision` model, else the first with an `llm` model. In **My clips** the card shows a badge while the text is being read, once it is ready, and when it could not be read. In the clip detail, the header has the book title, page, and buttons for OCR, deletion and opening the page in the viewer. **Show text** opens a separate dialog with selectable text, its source, **Copy**, and **Read again**. For a clip saved before OCR existed, **Read text** queues OCR. The collection re-reads its scope every 5 seconds while OCR is pending, for up to 5 minutes.

Open the paperclip beside a cover card's filename to see just that book's clips. Switch between **Date added** and **Page order** above the grid. A clip opens the same detail as **My clips**. Write in **Memo** under the capture and press **Save** to persist the text. **Reset** restores the last saved memo.

In the viewer, **OCR** opens the text dialog on the current page. Use the left and right buttons to browse one page at a time. The PDF viewer keeps its reading position. A previously scanned page shows its saved text. On an unscanned page, select **Scan page** to read the PDF text layer or send the rendered page to the configured AI server. The dialog shows a slow-scan hint after four seconds and a Settings hint if the page has no text and no AI server is configured.

An explicit scan keeps running when you browse another page or close the dialog. Its result stays available until the PDF changes. A scan request that fails to reach the runtime retries for about 30 seconds. Page and clip OCR are available for local library files. See the [page OCR API](../../../packages/pdfit/docs/api.md#ocr-local-runtime).

### Document scan

In a local PDF viewer, enter a start page next to **Scan** immediately before **Contents**, then choose **Start**. The scan runs through the last page using the same OCR as **OCR** and skips pages whose text is already in the database. Above the progress bar, a fixed-width button shows up to two in-flight page numbers and the total in flight. Open it to see every in-flight page in a compact grid that updates as the scan runs. The progress bar measures progress through the selected range. You can keep reading, switch documents, or close a viewer while the server runs the scan.

The small percentage beside **Scan** shows the share of all pages in the PDF with saved text. It includes text saved before the current scan and updates as new pages are saved. The display rounds down to a whole percent, reaching 100% when every page has saved text.

**Settings → AI Servers → Concurrent OCR requests** sets the selected AI server's parallelism for all document scans in the PDFit runtime. Existing and new AI server entries start at 1 unless configured. A document has one active scan shared by every viewer of that document. Cancel or an OCR/storage error stops dispatching pages for that document. Pages already in OCR can finish and save their results. A restart clears active jobs, and saved text remains available on the next scan.

Open **Scan** for a color-coded list of all pages. Green means the database has text for that page in the current file version. A page that produced empty text remains in the other group. See the [scan API](../../../packages/pdfit/docs/api.md#document-scan).

## Background tasks

The standalone server runs periodic jobs on one shared schedule and one pool of worker
threads. Cover thumbnails are the first job. Each run recomputes what is missing or
out of date, replaces whatever was still waiting from the previous run, and works
through it with a fixed number of workers. Page text for OCR (`page-text`) plans clips left pending by a restart and retains pending worker submissions for one-page OCR and document scans. Vision calls run outside the worker slots.

| Variable | Default | Effect |
| --- | --- | --- |
| `PDFIT_TASK_INTERVAL_MINUTES` | `60` | Minutes between runs (1 to 1440) |
| `PDFIT_TASK_CONCURRENCY` | `2` | Worker threads shared by all jobs (1 to 16) |
| `PDFIT_TASK_INITIAL_DELAY_SECONDS` | `30` | Delay before the first run after startup |
| `PDFIT_TASK_COOLDOWN_MS` | `0` | Pause after each task before its worker takes the next |
| `THUMBNAILS_ROOT` | `/app/data/thumbnails` | Where cover JPEGs are stored |

`GET /api/tasks/status` shows the queue, what the last run planned, and recent
failures. Deleting the thumbnails folder is safe; the next run renders it again.
