# Floating outline and reading position

Created 2026-11-27 KST.

## Environment

Run a separate Free Compose project with `npm run deploy:standalone` on port 15233. Use separate networks, database and bookmark directories. In the bound books directory, create `OutlineFixture` with `original.pdf`, `gpu.pdf`, `spread.pdf` and `scroll.pdf` using [the outline PDF fixture](../../../../packages/pdfit/tests/fixtures/outlinePdf.mjs) with `outline: true` for each file.

## Checks

1. Run `node apps/pdfit/tests/viewer-outline-save-page-browser.mjs`. Use `PDFIT_TEST_ORIGIN` for a different test port and `PDFIT_TEST_CHANNEL=chrome` for an installed Chrome.
2. Drag the outline title and resize with the bottom-right handle. Check the minimum size with the pointer and use the arrow key on the resize handle. Close with Escape, verify focus returns to the toolbar button and reload. The same book restores the changed geometry and another book uses its own geometry. Move the outline in narrow and short windows, then enlarge each and reload. Moving alone preserves its preferred width and height. Enter a page number from the toolbar with the outline open. The viewer updates and the panel remains open. Verify the top-right X in Arabic.
3. In PDF.js, choose the save icon beside page 3. Check that the viewer updates and the viewer-state PUT responds within 1200 ms. The normal write takes 1550 ms before network handling. Reopen the PDF in a fresh context and check that page 3 is restored.
4. Return a single HTTP 503 for the page 1 save. Check the error and current page, then retry the same button and verify the database returns page 1.
5. In a paired spread, choose page 2 and verify page 1 is saved as the spread’s first page. In continuous mode, choose page 3 and verify the nonzero scroll position and page after reload.
6. At mobile width, repeat the page 3 save and reload with PDFGPU. Both engines show save buttons only on entries with a destination.

## Evidence

Record container health, mounted fixture paths, viewer-state responses and request times, browser errors, screenshots and the Playwright trace. Open the `목차` dialog with `viewer-outline-open`. The title handle is named `목차 창 이동`, and the resize button is named `팝업 크기 조절`. Scope save buttons such as `3페이지로 이동하고 읽기 위치 저장` to the list item containing the chapter title. Read the displayed page from the `페이지 번호` textbox.
