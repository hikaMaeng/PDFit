# Usage

```text
npm run build
npm run deploy:standalone
npm run verify:pdfit
```

## npm installation

Requirements: Node.js 20 or newer with npm, and Docker Desktop (or Docker Engine) with Compose. Install the released launcher from GitHub:

```bash
npm install https://github.com/hikaMaeng/PDFit.git#v0.4.5
npx pdfit
```

The launcher checks Docker, asks for the host folder containing PDFs, runs the official build/Compose deployment, mounts that folder at `/app/data/books`, and opens `http://127.0.0.1:15203` (`PDFIT_STANDALONE_PORT`) with the platform browser launcher; `--no-open` skips the browser. It supports Windows, macOS, and Linux. Pass a folder as `npx pdfit /path/to/pdfs` to skip the prompt. Replace `v0.4.5` with another release tag when needed; `npx pdfit --help` shows the syntax.

The launcher runs `npm run deploy:standalone` with `PDFIT_BOOKS_SOURCE` set to the chosen folder (a bind mount instead of the external NAS volume) and `PDFIT_BOOKS_SUBPATH` empty. It binds the LAN port to `PDFIT_LAN_BIND_ADDRESS` from the shell or `.env`, or else to the first private IPv4 address of the host (`192.168.*`, then `10.*`, then `172.16-31.*`).

For source development, clone the repository, run `npm install`, set `PDFIT_LAN_BIND_ADDRESS` in `.env` to this host's IPv4 address, and then use `npm run deploy:standalone` from the repository root.

Open `http://127.0.0.1:15203` (or `PDFIT_STANDALONE_PORT`). The selected host folder is mounted at `/app/data/books` and is the library root, so PDFs already in that directory are visible immediately; folders created in PDFit are real directories below the mounted root.

Use `/settings` for AI server configuration; the database is embedded in the image and has no settings. The globe icon at the upper left opens the language and light/dark dialog. Use `/viewer` for the dedicated viewer entry.

## Cover view

Folder and tag pages have a list/cover toggle at the right of the toolbar. The cover view shows a card grid with each PDF's first page, title, tags, last-opened time, size, and the same actions as the list. Local files have no provider thumbnail, so the browser renders the first page with PDF.js (range requests, six at a time, only for visible cards) and keeps it in the `pdfit-cover-thumbnails-v1` Cache Storage entry keyed by URL and modification time. The chosen view is stored per browser in `localStorage` key `pdfit.library.view`.
