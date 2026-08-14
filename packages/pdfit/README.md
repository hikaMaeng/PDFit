Shared PDFit package for integrated service/viewer entries, visual bookmark
capture/rendering, common server routers, PDFium/WebGPU rendering, and
PostgreSQL metadata contracts.

| Goal                | File |
|---|---|
| Understand purpose | README.md |
| Overview | docs/overview.md |
| Architecture | docs/architecture.md |
| API reference | docs/api.md |
| Usage | docs/usage.md |
| Constraints | docs/constraints.md |
| Internals | docs/internals.md |
| Testing | docs/testing.md |

Primary exports are `@pdfit/pdfit/client/service`, `@pdfit/pdfit/client/viewer`, `@pdfit/pdfit/client/shared`, `@pdfit/pdfit/front/model/languagePreference`, `@pdfit/pdfit/server`, and `@pdfit/pdfit/server/postgres`.

The language preference model is shared by both service and integrated PDFit
entrypoints. It reads the persisted `pdfit.language` choice first, then the
browser language, and falls back to English; the service supplies translated
labels while the shared shell supplies the globe selector.

Bookmark API surfaces live at `src/front/api/bookmarks.ts` and
`src/server/api/bookmarks/index.ts`. The viewer adapter keeps absolute PDF
coordinates and delegates visible-page projection to `@pdfgpu/core`; the
PostgreSQL adapter stores metadata while JPEG assets live below the configured
bookmark volume. See [`docs/architecture.md`](docs/architecture.md),
[`docs/api.md`](docs/api.md), and [`docs/usage.md`](docs/usage.md).
