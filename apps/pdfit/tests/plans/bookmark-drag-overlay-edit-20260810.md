# Test Plan: bookmark-drag-overlay-edit

## Goal

Verify bookmark capture feedback, immediate PDF overlay projection, card editing,
comment hover, and zoom recalculation in the deployed viewer.

## Steps

1. Restore page 28 at 120% and open bookmark capture mode.
2. Drag a 300 by 300 pixel rectangle; assert `bookmark-drag-preview` is visible.
3. Release; assert a new `bookmark-page-overlay` and sidebar card appear.
4. Edit the created card: blue border, green fill at 35%, Korean comment; save.
5. Close capture mode, hover the overlay, then zoom once.

## Pass criteria

The browser observes POST and PATCH, no console/page errors, tooltip text is
visible, and the projected overlay width increases with zoom.
