# Test Plan: search-card-actions

## Goal

Verify that `/search` rows and cover cards expose the same document actions as
the folder and tag pages: tag chips with inline removal, manage tags, AI
auto-tag, document info, move, and delete.

## Steps

1. Deploy Free with `npm run deploy:standalone` and open `/search?q=ai`.
2. In list view, assert each row renders the manage-tags, AI auto-tag, document
   info, move, and delete controls.
3. Switch to cover view and assert each card renders its bottom action bar
   (`pdf-cover-actions`) with the same controls.
4. Open the manage-tags dialog from a card and confirm the book's current tags
   and the add-tag field are shown, then close it.
5. Open the move dialog from a card, confirm the destination picker lists other
   folders, then cancel.
6. Open the delete confirmation from a card, confirm it names the file, then
   cancel. No file is deleted.

## Pass criteria

Both views show the full action set, every dialog opens against the clicked
book, and no browser console error is raised by the search page.
