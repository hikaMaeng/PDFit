# Book Bot page selection

Use a Free Docker fixture with a separate PostgreSQL directory, a loopback port and no external AI settings. Generate the synthetic books with `node apps/pdfit/tests/viewer-scan-browser.mjs --fixtures <books-dir>` and deploy the fixture with `npm run deploy:standalone`. Run the [integration test](../book-bot-page-selection.mjs) with `PDFIT_TEST_ORIGIN`, `PDFIT_TEST_PROJECT`, `PDFIT_TEST_CONTAINER` and `PDFIT_TEST_OUTPUT`. Use a Compose project named apart from the live service, with a `pdfit-bot-pages-` prefix.

- Open a session and check the title and full outline before any AI request.
- Activate the fixture embedding model and wait for the current source revisions to be indexed. Ask for chapter four. The planner receives the question, outline and dialogue and returns a semantic query.
- Check that the answer tool result ranks page 30 first, outside the chapter's outline interval. Both a different filename in the same folder and the same filename in a different folder have better vector matches. Neither appears in the answer context. The stale OCR at page 12 is also excluded.
- Resume a session with a stored summary. A dialogue-only question does not call the embedding model. A content follow-up searches again within the same book. Verify that the complete outline remains in both model inputs and the original transcript remains visible.
- Check that the original question follows the tool result, the stream carries only answer fragments, and retry returns the same saved turn.
- In headless Chromium, open the viewer with the **Bot** toolbar button, start a new chat, fill **질문** and click **질문 보내기** in the **Bot** dialog. Hold the planner response, then hold the second answer fragment. Capture the status and the partial answer in the conversation log. Reload and confirm the saved reply.
- Run `node --test apps/pdfit/tests/ai-model-timeout.test.mjs packages/pdfit/tests/ocr.test.mjs` to check the shared queue, timeouts, follow-ups and prompt limits.
- Send a synthetic Korean chapter question through the configured APIBond model to check its retrieval JSON and answer stream. Record timing and ranges without uploading any library data.
- For an answer-quality change, ask for a summary and then ask why a specific design decision was made in the same chapter. Use the actual library's outline and indexed OCR on the configured local model. Replay the same page selection to compare answer formats with the sources held constant. Check that each answer directly addresses its request and grounds book-specific claims with page citations.
