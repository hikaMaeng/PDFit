# Test Plan: bookmark-library-navigation

## Goal

Verify the permanent left navigation renders BOOKMARKS between folder and tag
navigation, and its page projects persisted bookmarks by recent and book views.

## Steps

1. Open the service home screen and assert `lnb-bookmarks` is positioned after
   the folders section and before the tags section.
2. Navigate to `/bookmarks` through that menu.
3. Assert the bookmark library, recent tab, book tab, and persisted card render.
4. Select the book tab and open its card; assert the viewer URL matches the card book.

## Pass criteria

The browser reports no console/page errors and the card's title, page, border,
fill indicator, and comment are visible in the library projection.
