# Test Plan: viewer-bookmark-cross-window-sync

## Goal

Verify that deleting a bookmark from an open viewer immediately updates an
already open service window's bookmark gallery and left-navigation count.

## Steps

1. Create a temporary bookmark with a unique comment for a known book.
2. Open the service bookmark gallery and record its visible card and LNB count.
3. Open the book viewer in a separate browser page, reveal its bookmark panel,
   and delete the temporary bookmark.
4. Assert the service card disappears and its LNB count decrements without a
   navigation or page reload.
5. Remove the temporary record in `finally` if the UI deletion did not complete.

## Pass criteria

The viewer DELETE persists, the service window reacts through the cross-window
signal, the gallery and count reflect the deleted state, and neither page emits
a console or page error.
