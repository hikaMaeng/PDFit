# Library toolbar surface and protected root folder

## Purpose

Check that the light-mode selection/search and heading area uses the same background as document rows, while the protected root folder visibly explains why deletion is unavailable and ordinary folders remain deletable.

## Environment

- Windows 11, root Docker Compose `service` at `http://127.0.0.1:15201`.
- Local-preview account containing `PDFit Library`, at least one ordinary folder, and PDFs in the root and a tag.
- Playwright Chromium at 1440×900 in light and dark modes.

## Steps

1. Build `@pdfit/pdfit` and `service`, update root Compose `service`, and wait for health.
2. Sign in once with the local-preview account and reuse its browser storage state. Add one ordinary folder only to the intercepted browser cache response; do not create or delete Drive data.
3. In light mode open `/folder/PDFit%20Library` and a tag list. Wait for a document row; compare the computed `library-fixed-controls` background to the row background.
4. Inspect the root folder row. Confirm that a visible, disabled trash icon is present, that its tooltip says the default folder cannot be deleted, and that no deletion request occurs.
5. Inspect an ordinary folder row. Confirm its delete button remains visible and enabled; do not click it.
6. Repeat in dark mode and confirm the fixed controls retain the prior dark default background.

## Pass criteria

- Light fixed controls and document rows have the same opaque surface color in folder and tag pages.
- Root deletion is visibly unavailable with a truthful explanation; ordinary folder deletion remains available.
- Dark colors and folder data remain unchanged, builds succeed, Docker service is healthy, and browser results are written to a timestamped report.
