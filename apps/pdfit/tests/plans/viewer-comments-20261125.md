# Viewer comments

Run `node apps/pdfit/tests/viewer-comments-browser.mjs` with `PDFIT_TEST_ORIGIN` pointing to a disposable standalone library named `Viewer comments test library` containing a three-page `Fixture/Viewer comments.pdf`. Set `PDFIT_TEST_ARTIFACT_DIR` to the screenshot and trace directory. The script seeds six comments and recognizes only its own earlier fixture notes on rerun.

- At 1280 px, open **Comments** from the PDF.js toolbar. Confirm a non-modal panel with five posts, scroll its body, move it with the mouse, navigate the PDF, and dismiss it with the toolbar.
- Open the same book with `engine=gpu`. Move the panel from its keyboard grip, open the second comments page, and save a post. Close with **Close** and check toolbar focus. Confirm the cover card shows the same saved post in its modal.
- At 390 px with touch input, move the floating window and confirm it stays on screen after resizing to 320 px. Capture evidence for both renderers and the touch layout.
- After deployment, check health and release versions for standalone and hosted services. Open an indexed library book in the standalone viewer, read comments, and close the panel without writing user data.
