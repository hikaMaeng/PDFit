# Library list mode

Created 2026-11-25.

## Environment and fixture

Use the standalone deploy script with an isolated Compose project, loopback port, and disposable data, bookmarks, and PDF directories. Name the library `List mode test library`. Put valid PDFs named `List feature specimen.pdf` and `Reference volume with a deliberately long filename for desktop and mobile.pdf` under `Fixture`. Create a `Destination` directory. The scenario renames, moves, and deletes `List feature specimen.pdf`.

## Scenario

1. Set `PDFIT_TEST_ORIGIN` and `PDFIT_TEST_ARTIFACT_DIR`. Run `node apps/pdfit/tests/library-list-mode-browser.mjs`.
2. In folder, tag, and title search, check the filename and file-size headings, cover height, saved tag glyph, tag actions, and the right-side action order.
3. At phone width, check that the action strip fits below the filename and that the page has no horizontal overflow.
4. Verify the folder toolbar shows the document count and two view buttons. Check that the toolbar and the books have no selection checkboxes or bulk AI action in list or cover view on desktop and phone.
5. Add a favorite, comment, and manual tag to one book. Verify the tag is saved only for that book. Open the clip dialog. Switch to cover view and verify the same favorite, comment, cover, and cover replacement dialog.
6. Intercept AI auto tagging and external cover search in Chromium. In each view, verify the AI request targets one book and adds the returned tag only to that book. Verify that the cover dialog uses the current filename as its initial query.
7. Rename and move the test PDF. Open its destination folder and delete it. Capture screenshots, the trace, and page exceptions. Record Docker health and the fixture mount.
8. For cover replacement changes, run `apps/pdfit/tests/real-cover-early-selection-browser.mjs` twice with `PDFIT_TEST_LIBRARY_VIEW=list` and `PDFIT_TEST_LIBRARY_VIEW=covers`. Its isolated cover router controls the upstream responses. Verify that an applied cover version is rendered in both modes and that retry and cancellation still work.

Scope actions by their accessible button names inside the list item identified by the filename link. Use `pdf-cover-thumbnail`, `pdf-tag-chip`, and `pdf-file-size` for visible media and layout checks.
