# Book clips and memo test plan

Created 2026-11-23.

## Goal and environment

Verify the deployed Free library and shared clip detail in headless Chrome at
1440 × 900 and 375 × 812. Confirm Docker health and book-volume visibility first.
Use a library book that already has an OCR-complete clip, a temporary clip on
a different page of that book, and a temporary clip with the same filename in
another folder. Remove only the temporary clip IDs after the run.

## Steps and expected results

1. In cover view, open **클립 보기** in the filename row. The dialog lists only
   the selected book's clips in a grid. The cover button does not open a viewer.
2. Check **추가 일시** against capture timestamps and **페이지 순서** against page
   numbers. Open a book with no clips and check its empty message.
3. Open the temporary clip. The header shows its book, page, OCR, delete, and
   viewer actions. Edit the memo and reset to the last saved text. Save a
   multiline memo, reload, and verify it in the card and both detail entry
   points. Verify clearing by saving an empty memo.
4. Run `node apps/pdfit/tests/clip-text-pane-browser.mjs` on the OCR-complete
   clip. Check both viewports for unchanged detail geometry, retained draft,
   selectable API-matching OCR, restored focus, and no horizontal overflow.
5. Check that the viewer action sends the correct book and page to the viewer.
   Delete the temporary clip from the grid and verify its disappearance in the
   API. Compare remaining clip IDs and memos with the pre-run list.

## Evidence and locators

Capture screenshots of the cover, gallery, detail, and OCR dialog. Record the
scoped request and mutation statuses, cleanup, and browser errors.
Use `pdf-cover-title-row`, `pdf-cover-clips`, `book-clips-dialog`,
`bookmark-library-card`, `bookmark-preview-dialog`, and `clip-text-pane`.
Select sorting buttons and the memo textbox by their accessible names.
