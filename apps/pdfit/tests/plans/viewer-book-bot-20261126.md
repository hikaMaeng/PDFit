# Viewer Bot test plan

Created 2026-11-26 KST.

## Environment and setup

Build Free with `npm run build:pdfit`. Start a disposable Docker instance using the Free image and that build, a two-book synthetic library, and PostgreSQL. Use a local fixture chat and vision endpoint that checks input markers and returns deterministic replies. Keep the fixture books, sessions and model configuration isolated from the regular library.

## Steps and expected results

1. Save page OCR through the app, store an outline and book comment, and seed a clip with an image, OCR and note. Check book title and every source type in model input. Insert stale OCR and confirm that the Bot excludes it.
2. Open **Bot** from the toolbar. Drag its header and move it with the keyboard. Send a first question and a follow-up. Capture the conversation, verify the model-generated title and confirm the follow-up receives both earlier roles.
3. Expand the OCR beyond the direct context budget. Verify that the beginning and end reach the final request through evidence extraction. Open a separate PDF that has embedded contents and no stored outline, then verify those contents reach the model.
4. Open a new chat, open history, check that both titles and first start times are visible, and select the older session. Close the Bot or reload the viewer and check that Bot opens the latest session.
5. Replay a completed turn ID and send a stale competing revision. Confirm the final row counts, book isolation and response statuses for missing model and cross-origin browser requests.
6. Run the mobile viewport flow with the same accessible locators. Check that the panel fits and the input remains available.

## Evidence

Capture Docker health and HTTP statuses, model payload assertions, PostgreSQL session counts, and Chrome screenshots and trace. Use the [shared Bot locator contract](../../../../packages/pdfit/docs/book-bot.md#verification). Check the regular Free container's published health and library volume after deployment.
