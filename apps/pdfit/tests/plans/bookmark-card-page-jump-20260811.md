# Test Plan: bookmark-card-page-jump

## Goal

Verify the page-jump icon in each in-viewer bookmark card navigates to the
bookmark page while preserving the card-click editor behavior.

## Steps

1. Open a persisted-bookmark viewer and open the Book bookmarks panel.
2. Capture the first card's page label and activate its page-jump icon.
3. Assert the viewer page input becomes that page and the edit dialog remains closed.
4. Capture a browser screenshot of the card and resulting viewer page.

## Pass criteria

The icon is visible at the right edge of the card metadata row, routes to the
matching page, and no console or page error occurs.
