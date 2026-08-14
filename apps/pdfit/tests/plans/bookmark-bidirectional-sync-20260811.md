# Bookmark bidirectional synchronization — 2026-08-11

## Scope

Verify that completed bookmark create, comment/color update, and delete mutations publish one
book-targeted message through the shared router and reload authoritative PostgreSQL data in service
and viewer windows.

## Procedure

1. Seed an isolated bookmark for an existing book through the API.
2. Open `/bookmarks` and that book's `/viewer/:folder/:filename` in one browser context.
3. Edit the viewer card comment and border color; verify the service gallery reflects both.
4. Delete the service gallery card; verify the viewer card disappears and LNB count decrements.
5. Record console/page errors, screenshots, and JSON report under `test/20260811/bookmark-bidirectional-sync/`.

## Acceptance

* The service and viewer show the same persisted content after a viewer update.
* A service deletion is visible in the already-open matching viewer without reload.
* No page or console error occurs.
