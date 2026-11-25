# Library list mode

Created 2026-11-25.

## Environment and fixture

Use the standalone deploy script with an isolated Compose project, loopback port, and disposable data, bookmarks, and PDF directories. Name the library `List mode test library`. Put valid PDFs named `List feature specimen.pdf` and `Reference volume with a deliberately long filename for desktop and mobile.pdf` under `Fixture`. Create a `Destination` directory. The scenario renames, moves, and deletes `List feature specimen.pdf`.

## Scenario

1. Set `PDFIT_TEST_ORIGIN` and `PDFIT_TEST_ARTIFACT_DIR`. Run `node apps/pdfit/tests/library-list-mode-browser.mjs`.
2. In folder, tag, and title search, check the filename and file-size headings, cover height, saved tag glyph, tag actions, and the right-side action order.
3. At phone width, check that the action strip fits below the filename and that the page has no horizontal overflow.
4. Select a folder row, add a favorite and comment, and open the clip and tag dialogs. Switch to cover view and verify the same favorite, comment, cover, and cover replacement dialog.
5. Intercept AI auto tagging and external cover search in Chromium. Check that the AI result adds the returned tag and that the cover dialog uses the current filename as its initial query.
6. Rename and move the test PDF. Open its destination folder and delete it. Capture screenshots, the trace, and page exceptions. Record Docker health and the fixture mount.
7. Run `apps/pdfit/tests/real-cover-early-selection-browser.mjs` twice with `PDFIT_TEST_LIBRARY_VIEW=list` and `PDFIT_TEST_LIBRARY_VIEW=covers`. Its isolated cover router controls the upstream responses. Verify that an applied cover version is rendered in both modes and that retry and cancellation still work.

Scope actions by their accessible button names inside the list item identified by the filename link. Use `pdf-cover-thumbnail`, `pdf-tag-chip`, and `pdf-file-size` for visible media and layout checks.
