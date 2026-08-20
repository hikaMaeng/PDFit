# Testing

Shared package changes are verified through:

* `npm run build`
* `npm run verify:repo`
* `npm run verify:pdfit`
* `npm run test:pdfgpu`
* `npm run verify:release-contract`
* integrated app build and deploy
* service/viewer manifest checks that confirm dedicated front entries
* `GET /health` returns a JSON `{ ok: true, service }` response for `pdfit`
* repository guards that reject legacy dist references
* PostgreSQL/pgvector extension, shared metadata CRUD, and Settings CRUD checks
  against the deployed integrated container

`npm run sync:pdfgpu` builds the sibling `@pdfgpu/core`, packs it, verifies its
source commit and SHA-256 manifest, and relinks the local PDFit dependency.
The independent core suite runs in `F:\dev\pdfgpu`; PDFit integration tests then
load the local source package API and app-owned `ViewerSessionModel`.
`verify:release-contract` additionally checks every PDFit package version,
the installed core package version, source specifier, source commit, and
artifact digest as one source contract. The contract is selected from
`release-contracts/pdfit/v<PDFit-version>.json`, so old PDFit-to-pdfgpu mappings
remain auditable after either project advances independently.

GPU viewer browser contract:

* `getByRole('toolbar', { name: 'viewer controls' })`
* `getByRole('status', { name: 'viewer status' })`
* `getByRole('region', { name: 'PDF viewer' })`
* `data-testid="pdfgpu-scroll-area"` and `data-testid="pdfgpu-page-shell"`
* `data-testid="viewer-load-progress"` displays the interpolated loading gauge;
  the PDFGPU source 35% is the PDFit display 100% endpoint.
* `data-testid="bookmark-capture-surface"`, `bookmark-drag-preview`,
  `bookmark-page-overlay`, `bookmark-card`, `bookmark-card-go-to-page`, and `bookmark-editor`

Bookmark interaction coverage must assert a visible drag preview, a POST-created
overlay without opening the bookmark sidebar or reloading, PATCH persistence through the editor, comment tooltip,
and a changed overlay bounding box after zoom.
It must also assert that the toolbar bookmark control only toggles the sidebar
and that a newly created bookmark's delete affordance fades from emphasized to
resting opacity.
It must also assert that the card's page-jump icon navigates to that bookmark's
page without opening the editor.
The bookmark-library new-window flow must first persist a different viewer page,
then assert that `?page=` wins after the loading indicator disappears. This guards
the shared `goToPage` path against saved-scroll restoration races.
The reused-window flow opens one book from a folder, sends its bookmark page while that
viewer is loading, then activates the same folder and tag rows. It must keep one popup,
finish at the commanded page, and report no browser errors.
The bidirectional bookmark flow creates an isolated bookmark, edits its comment and colors in
a separate viewer page, then asserts the service gallery reflects those values. It deletes from
the service gallery and asserts the matching viewer card disappears, with no navigation or
manual refresh. Create, edit, and deletion all use the same book-targeted signal contract.
The router contract additionally requires one transport owner, topic-based lambda dispatch, message
ID de-duplication, and domain payload validation before an API/model action runs.

Bookmark library browser contract:

* `data-testid="lnb-bookmarks"` navigates to `/bookmarks` between folder and tag navigation.
* `data-testid="bookmark-library-page"` exposes recent and per-book tabs.
* `data-testid="bookmark-library-card"` opens the original-capture preview dialog.
* `bookmark-preview-dialog` renders the unfilled capture, border, optional color indicator,
  metadata footer, and `bookmark-preview-open-viewer` new-window action.
* A file row remains a native link named by its filename; its ordinary click is intercepted by
  the shared viewer launcher, while modifier-click keeps normal browser-link behavior.

The deployed GPU viewer also keeps the composited frame pinned to the scroll
viewport while page content moves underneath it. The scroll-boundary regression
test records this contract in `apps/pdfit/tests/reports/pdfgpu-scroll-stability/`
and captures top/middle browser screenshots under `test/YYYYMMDD/<run>/`.
* `data-testid="pdfgpu-text-layer"` on retained page shells

The performance scenario must load a real PDF, assert page shells and canvas
output, exercise zoom/fit/view-mode controls, and record whether the backend is
`webgpu` or the supported 2D fallback.

Hosted IndexedDB changes require a real browser engine. The service browser fixture uses
mock authentication and a mock Spreadsheet snapshot to verify first hydration, reload
without another request, and reconstruction after database deletion without Google API calls.
