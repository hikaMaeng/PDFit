# AI streaming test plan

Created 2026-11-26 KST.

## Environment and goal

Build with `npm run build:pdfit`. Use a disposable Docker Free server with its own PostgreSQL data, a synthetic PDF, Chrome, and a local model fixture that can pause or close an SSE response. Repeat one synthetic Bot request against the Free Settings model to confirm real upstream SSE behavior.

## Scenario and expected results

1. Open the viewer's **Bot** button and send a question through the **Question** field. Emit part of the answer, hold the upstream connection open, and confirm that the text is visible and PostgreSQL still has zero turns. Check that model reasoning and the first-turn title marker stay out of the message body.
2. Finish the SSE stream and verify the combined answer and first-turn title. Assert a single committed turn.
3. Stream a partial reply followed by an incomplete EOF. Verify an alert, the original draft, and the same stored turn count. Retry using the same turn ID and verify a single new turn.
4. Close the client connection during a different reply and let the upstream finish. Verify the complete stored answer, reload in Chrome, and replay the turn ID. A replay should make no new model request.
5. Run the AI transport regression suite with split UTF-8 and SSE frame boundaries, model OCR, tagging and translation. Verify the existing JSON-provider fallback and rejection of incomplete model results.
6. Deploy Free after confirming no document scan is running. Check published health, container health, the mounted library, and the production viewer's Bot session load.

## Evidence

Use the named **Bot** dialog, question textbox, send button, rendered reply, and alert. Capture browser screenshots before and after commit, a trace, PostgreSQL turn counts, and the Docker logs.
