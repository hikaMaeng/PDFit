# Floating outline and page assignment

Created 2026-11-27 KST.

## Environment

Run a separate Free Compose project with `npm run deploy:standalone` on port 15233. Use separate networks, database and bookmark directories. In the bound books directory, create `OutlineFixture` with `original.pdf`, `gpu.pdf`, `spread.pdf` and `scroll.pdf` using [the outline PDF fixture](../../../../packages/pdfit/tests/fixtures/outlinePdf.mjs) with `outline: true` for each file.

## Checks

1. Run `node apps/pdfit/tests/viewer-outline-save-page-browser.mjs`. Use `PDFIT_TEST_ORIGIN` for a different test port and `PDFIT_TEST_CHANNEL=chrome` for an installed Chrome.
2. Drag the outline title and resize with the bottom-right handle. Check the minimum size with the pointer and use the arrow key on the resize handle. Close with Escape, verify focus returns to the toolbar button and reload. The same book restores the changed geometry and another book uses its own geometry. Move the outline in narrow and short windows, then enlarge each and reload. Moving alone preserves its preferred width and height. Enter a page number from the toolbar with the outline open. The viewer updates and the panel remains open. Verify the top-right X in Arabic.
3. Click Chapter 2 to go to page 3 with the popup open. Assign page 3 to Chapter 1. Verify the dialog and viewer page stay in place, and only the selected row changes in the list and stored outline.
4. Enter page 1 and return a single HTTP 503 when assigning it to Chapter 2. Verify the error, unchanged destination, current page, and open dialog. Retry the assignment. Assign page 1 to the unlinked Missing entry and verify it becomes navigable. Reopen the book in a fresh browser context and check all saved destinations.
5. In a paired spread, navigate to Section 1.1 (page 2), then verify its spread starts at page 1 and assign that displayed page to Chapter 2. In continuous mode, navigate to page 3 and verify the viewer's scroll position stays fixed while assigning it to Chapter 1.
6. At mobile width, repeat the navigation to page 3 and assignment to Chapter 1.

## Evidence

Record container health, mounted fixture paths, outline responses, browser errors, screenshots and the Playwright trace. Open the `목차` dialog with `viewer-outline-open`. The title handle is named `목차 창 이동`, and the resize button is named `팝업 크기 조절`. Scope `pdf-outline-entry` and buttons such as `현재 페이지로 설정 (3페이지)` to the list item containing the chapter title. Read the viewer page from the `페이지 번호` textbox.
