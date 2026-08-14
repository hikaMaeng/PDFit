# Usage

```text
npm run build
npm run deploy
npm run verify:pdfit
```

## npm installation

Requirements: Node.js 20 or newer with npm, and Docker Desktop (or Docker Engine) with Compose. Install the released launcher from GitHub:

```bash
npm install https://github.com/hikaMaeng/PDFit.git#v0.4.0
npx pdfit
```

The launcher checks Docker, asks for the host folder containing PDFs, runs the official build/Compose deployment, mounts that folder at `/app/data/books`, and opens `http://127.0.0.1:15201` with the platform browser launcher. It supports Windows, macOS, and Linux. Pass a folder as `npx pdfit /path/to/pdfs` to skip the prompt. Replace `v0.4.0` with another release tag when needed; `npx pdfit --help` shows the syntax.

For source development, clone the repository, run `npm install`, and then use `npm run deploy` from the repository root.

Open `http://127.0.0.1:15201`. The selected host folder is mounted at `/app/data/books` and is the library root, so PDFs already in that directory are visible immediately; folders created in PDFit are real directories below the mounted root.

Use `/settings` for AI server and pgvector configuration. Use `/viewer` for the dedicated viewer entry.
