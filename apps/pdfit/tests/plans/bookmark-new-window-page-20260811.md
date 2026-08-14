# Test Plan: bookmark-new-window-page

## Goal

Verify an explicit bookmark page in a new viewer URL overrides a different
persisted viewer page after PDFGPU loading completes.

## Steps

1. Persist page 45 and its scroll position for the bookmarked document.
2. Open the bookmark library preview for its page 35 bookmark.
3. Activate the new-window action and wait until the viewer loading indicator
   disappears.
4. Assert the popup URL keeps `page=35`, the page control reports 35, page 35 is
   rendered in detail, and no browser error occurred.

## Pass criteria

The explicit URL page remains active after loading completes and is not replaced
by the persisted page or scroll position.
