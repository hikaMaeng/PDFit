# Test Plan: bookmark-library-preview

## Goal

Verify a bookmark-library card opens an unfilled original-capture preview and
can open its book in a new viewer window at the bookmark page.

## Steps

1. Open the bookmark library and select a persisted card with a fill color.
2. Assert the preview dialog shows its capture, border, color indicator, and
   book/page/comment footer without a fill overlay.
3. Activate the new-window action and assert the popup viewer receives the
   bookmark page through its URL and renders that page.

## Pass criteria

The modal keeps the border and color dot only, displays the required footer,
opens a separate viewer page at the correct page, and reports no browser error.
