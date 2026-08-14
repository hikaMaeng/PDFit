# Test Plan: bookmark-card-three-row

## Goal

Verify every bookmark-library card uses one fixed-height image frame and a
three-row information area ordered as title/page, bookmark creation date and
time, then comment.

## Steps

1. Deploy the integrated PDFit service and open `/bookmarks` at desktop size.
2. Wait for persisted bookmark cards and inspect every card image frame.
3. Assert every image frame is exactly 150 px high.
4. Assert each card exposes title, creation timestamp, and comment rows in that
   vertical order, including an empty reserved comment row.
5. Assert cards in the first grid row have an identical total height.
6. Capture the rendered library and record browser console/page errors.

## Pass criteria

All image frames are 150 px high, all three information rows are present and
ordered, first-row card heights match, and the browser reports no console or
page errors.
