Integrated PDFit service and viewer application containing library management,
high-resolution visual bookmarks, WebGPU PDF rendering, AI settings, and the
embedded pgvector runtime.

The service header and favicon use [`public/brand/pdfit-logo-dark.png`](public/brand/pdfit-logo-dark.png). Keep the mark compact: the blue rear document carries white `PD`, while the short white overlapping panel carries black `Fit`.

| Goal | File |
| --- | --- |
| Overview | docs/overview.md |
| Architecture | docs/architecture.md |
| API | docs/api.md |
| Usage | docs/usage.md |
| Constraints | docs/constraints.md |
| Internals | docs/internals.md |
| Testing | docs/testing.md |

## Bookmark workflow

The viewer's bookmark tool captures a dragged page rectangle through PDFGPU and
sends the high-resolution Base64 image plus absolute PDF coordinates to the
bookmark API. The server persists a quality-90 JPEG under the bookmark asset
volume and stores metadata in PostgreSQL. The viewer projects overlays only for
visible pages, so zoom, scroll, page navigation, continuous scroll, and
two-page layout remain synchronized.

The `/bookmarks` surface provides recent and book-grouped galleries, original
capture preview, page jump, color/comment editing, and deletion. The same
deletion action is available on the preview modal, viewer page overlay, and
viewer bookmark-bar card.

## Installation

### npm launcher

Requirements: Node.js 20 or newer with npm, and Docker Desktop (or Docker Engine) with Compose. Install the released launcher from GitHub:

```bash
npm install https://github.com/hikaMaeng/PDFit.git#v0.4.0
npx pdfit
```

The command asks for the PDF library root. Pass it as an argument to skip the prompt, for example `npx pdfit /path/to/pdfs`; the path may be Windows, macOS, or Linux. The launcher runs the official Docker deployment and mounts that folder at `/app/data/books`. Use `npx pdfit --help` for the command syntax.

### Repository development

```bash
git clone https://github.com/hikaMaeng/PDFit.git
cd PDFit
npm install
npm run deploy
```
