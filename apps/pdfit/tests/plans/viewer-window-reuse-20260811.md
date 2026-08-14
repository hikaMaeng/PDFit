# Test Plan: viewer-window-reuse

## Goal

Verify that folder, tag, and bookmark actions reuse the existing viewer for one
book, and that a bookmark page command arriving during PDFGPU loading is applied
after loading completes.

## Steps

1. Save a different viewer page for a bookmarked book, then open that book from
   its folder row and wait until the loading gauge becomes visible.
2. From the bookmark preview, open the same book's captured page.
3. Assert no second popup was created; after the gauge disappears, assert the
   original popup's page control and detail shell show the bookmark page.
4. Activate the same folder row and its tag-page row. Assert each keeps the
   single popup and preserves the already commanded page.
5. Restore the saved viewer state in `finally` and capture the final viewer.

## Pass criteria

Exactly one viewer window exists for the `(folder, filename)` pair, it receives
the requested bookmark page after loading, folder/tag reuse does not reload or
duplicate it, and no browser console or page error occurs.
