# Book Bot page selection

Use a Free Docker fixture with a separate PostgreSQL directory, a loopback port and no external AI settings. Generate the synthetic books with `node apps/pdfit/tests/viewer-scan-browser.mjs --fixtures <books-dir>` and deploy the fixture with `npm run deploy:standalone`. Run the [integration test](../book-bot-page-selection.mjs) with `PDFIT_TEST_ORIGIN`, `PDFIT_TEST_PROJECT`, `PDFIT_TEST_CONTAINER` and `PDFIT_TEST_OUTPUT`. Use a Compose project named apart from the live service, with a `pdfit-bot-pages-` prefix.

- Open a session and check the title and full outline before any AI request.
- Ask for chapter four. Check two model inputs, confirm that the planner receives no OCR and that the answer receives only the current OCR for PDF pages 8–21. Exclude the stale row on page 12. Record the SSE phases and retry the saved turn ID.
- Seed the stored OCR token count past 80% twice. Confirm that the planner uses only the last summary and the new exchanges on the second rollover. Check that the complete outline remains in both model inputs and all original exchanges remain public. Inspect the summary and its revision in PostgreSQL.
- In headless Chromium, open the viewer with the **Bot** toolbar button, start a new chat, fill **질문** and click **질문 보내기** in the **Bot** dialog. Hold the planner response, then hold the second answer fragment. Capture the status and the partial answer in the conversation log. Reload and confirm the saved reply.
- Run `node --test apps/pdfit/tests/ai-model-timeout.test.mjs packages/pdfit/tests/ocr.test.mjs` to check the shared queue, timeouts, follow-ups and prompt limits.
- Send a synthetic Korean chapter question through the configured APIBond model to check its retrieval JSON and answer stream. Record timing and ranges without uploading any library data.
