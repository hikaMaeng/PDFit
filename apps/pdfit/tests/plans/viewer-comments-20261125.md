# Viewer comments

Run `node apps/pdfit/tests/viewer-comments-browser.mjs` with `PDFIT_TEST_ORIGIN` pointing to a disposable standalone library named `Viewer comments test library` containing a three-page `Fixture/Viewer comments.pdf`. Set `PDFIT_TEST_ARTIFACT_DIR` to the screenshot and trace directory. The script seeds six comments and recognizes only its own earlier fixture notes on rerun.

- At 1280 px, open **Comments** from the PDF.js toolbar. Confirm a non-modal panel with five posts, scroll its body, move it with the mouse, navigate the PDF, and dismiss it with the toolbar.
- Open the same book with `engine=gpu`. Move the panel from its keyboard grip, open the second comments page, and save a Markdown post. Read it by its heading, table, checklist, and footnotes. Check the plain-text textarea and API body against the source, including a first-line indented code block and trailing newlines after editing. Close with **Close** and check toolbar focus.
- Open **Comments** on the cover card. Edit the same post in the textarea, save, and check the rendered delete confirmation. Cancel deletion, switch to the library list, and open **Comments** from the book row to check the saved post.
- At 390 px with touch input, open the PDF.js viewer and read the updated post. Move the floating window, then resize to 320 px. Verify that long code scrolls within the comment and the panel stays on screen. Capture evidence for both renderers, the cover, list, and touch layout.
- Use the **Comments** dialog and labeled buttons by role and accessible name. Use `book-comments-content` to measure scrolling and `viewer-comments-drag-handle` for pointer and keyboard drag. Keep the trace with the screenshots.
- After deployment, check health and release versions for standalone and hosted services. Open an indexed library book in the standalone viewer, read comments, and close the panel without writing user data.
