# Book card and comments test plan

Created 2026-11-24.

## Environment

Use a disposable Free Compose project and a loopback port. Give it independent
PostgreSQL, bookmark, and book paths. Seed two valid PDFs named
`Fixture/Card fixture.pdf` and `Fixture/Existing name.pdf` and create an empty
`Destination` folder. The fixture library root name is `Comment test library`.
Confirm Docker health, `/health`, and the two fixture files inside the mount.

## Expected results

1. The cover overlay places auto-classification after the tags. The card footer
   starts with Comments and the file actions menu includes rename, move, delete.
2. Submit two posts, page to the older one, edit it, and check that the other
   PDF's board stays empty. Verify that a comment ID cannot edit another book.
   Open the separate clip dialog from the title row.
3. Reject invalid names and existing filenames. Rename without typing `.pdf`.
   Verify the file bytes, tag, favorite, viewer state and clip ID and memo.
4. Reload, reopen the board, and delete the newer post. Move the book and open
   the remaining post on a touch viewport. Delete the file and verify the post
   is removed with it.

## Run and evidence

Set `PDFIT_TEST_ORIGIN` and `PDFIT_TEST_ARTIFACT_DIR`, then run
`node apps/pdfit/tests/book-card-comments-browser.mjs` once on the seeded
fixture. The test deletes its source PDF in the final step. Use fixture copies.
Capture Docker health and route statuses, Chromium page errors, screenshots
and a Playwright trace.

Scope controls by exact accessible name and role inside the card or dialog.
Use `pdf-cover-card`, `pdf-cover-tags`, `pdf-cover-actions`, and
`pdf-cover-clips` to distinguish the interactive regions.
