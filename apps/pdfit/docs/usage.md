# Usage

```text
npm run build
npm run deploy:standalone
npm run verify:pdfit
```

## npm installation

Requirements: Node.js 20 or newer with npm, and Docker Desktop (or Docker Engine) with Compose. Install the released launcher from GitHub:

```bash
npm install https://github.com/hikaMaeng/PDFit.git#v0.4.4
npx pdfit
```

The launcher checks Docker, asks for the host folder containing PDFs, runs the official build/Compose deployment, mounts that folder at `/app/data/books`, and opens `http://127.0.0.1:15201` with the platform browser launcher. It supports Windows, macOS, and Linux. Pass a folder as `npx pdfit /path/to/pdfs` to skip the prompt. Replace `v0.4.4` with another release tag when needed; `npx pdfit --help` shows the syntax.

The launcher still runs `npm run deploy` and opens port `15201`; in the current root Compose file those belong to the hosted service, so use the source path below until the launcher follows the standalone profile.

For source development, clone the repository, run `npm install`, set `PDFIT_LAN_BIND_ADDRESS` in `.env` to this host's IPv4 address, and then use `npm run deploy:standalone` from the repository root.

Open `http://127.0.0.1:15203` (or `PDFIT_STANDALONE_PORT`). The selected host folder is mounted at `/app/data/books` and is the library root, so PDFs already in that directory are visible immediately; folders created in PDFit are real directories below the mounted root.

Use `/settings` for AI server and pgvector configuration. Use `/viewer` for the dedicated viewer entry.

## Cover view

Folder and tag pages have a list/cover toggle at the right of the toolbar. The cover view shows a card grid with each PDF's first page, title, tags, last-opened time, size, and the same actions as the list. Local files have no provider thumbnail, so the browser renders the first page with PDF.js (range requests, six at a time, only for visible cards) and keeps it in the `pdfit-cover-thumbnails-v1` Cache Storage entry keyed by URL and modification time. The chosen view is stored per browser in `localStorage` key `pdfit.library.view`.
