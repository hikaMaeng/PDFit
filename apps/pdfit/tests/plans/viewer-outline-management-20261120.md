# Viewer outline management test plan

## Created

2026-11-20 KST

## Goal

Verify that PDF.js and PDFGPU use the same saved outline and that edits, deletion and regeneration survive reopening.

## Environment and preconditions

Use an isolated Free Compose project with an empty data directory and a loopback port. Build and start it with `npm run deploy:standalone`, overriding the Compose project, network names, published port and library/data mounts. Place `original.pdf` and `no-outline.pdf` under `OutlineFixture` in the isolated library. Generate the PDFs with [`buildOutlinePdf`](../../../../packages/pdfit/tests/fixtures/outlinePdf.mjs), using `outline: true` and `outline: false` respectively. Each run starts with no stored outline for either fixture.

## Steps and expected results

1. Run `npm run test:outline`. Supply `PDFIT_TEST_DATABASE_URL` on an isolated PostgreSQL instance to include the storage lifecycle test.
2. Run `node apps/pdfit/tests/viewer-outline-management-browser.mjs` from the workspace root. Set `PDFIT_TEST_ORIGIN` if the port differs from `15233`.
3. Edit the first title, destination and level. An out-of-range page is rejected. Add and remove a row. Inject one failed PUT, check the draft and stored data, then save and reload. Selecting the edited row jumps to its new page.
4. Cancel deletion once and confirm it once. Reload and verify the empty state. A conditional initialization must return `412` while the deletion is stored. Regenerate and compare the stored rows with the original outline.
5. At mobile width, add an outline to the PDF without an embedded outline. Regeneration reports the missing embedded outline and retains the saved entry.
6. Open the original with `?engine=gpu`. Confirm `pdfgpu-scroll-area` exists and regeneration restores the same outline.

## Evidence and locators

Capture Docker health, the mounted fixture paths, browser errors, HTTP status codes, screenshots and the Playwright trace. Open the named `목차` dialog with `viewer-outline-open`. Use action names `목차 편집`, `목차 삭제`, `재생성`, `저장` and `취소`. Scope editor inputs to `pdf-outline-edit-row` and navigation to `pdf-outline-entry`.
