# Bot context, progress and page links test plan

Created 2026-11-26 KST.

## Environment

Build Free and run disposable Docker with a synthetic six-page PDF, PostgreSQL, a gated SSE upstream and headless Chrome. Seed roughly 47 KB of current-version OCR across the PDF. Use the current Free deployment for a read-only history smoke check after deployment.

## Steps

1. Set the AI server's Bot context to 150,000 tokens. Verify API round trip and invalid-value rejection. Send a question through the viewer's **Bot** dialog and verify one final model request containing beginning and end OCR markers.
2. Pause after the first reasoning frame. Check the visible **status**, no saved turn yet, and the absence of internal model text in the chat. Resume and observe the completed answer.
3. Click bracketed, bare, upper-case and end-of-line page references in the reply. Check the viewer page textbox after each click, including a return to the first cited page. An out-of-range page, inline code, decimal, partial word and external URL should stay plain text.
4. Reload the discussion in the PDFGPU renderer and navigate using saved citations. Clear the context setting, pause the first evidence request, and check the section counter before resuming.
5. Deploy Free and verify both published health endpoints, in-container library visibility, the configured token window, and a page link from an existing conversation.

## Evidence

Use **Bot**, its named dialog, the **Question** and **Page number** textboxes, in-dialog link text, and the **status** region. Capture the model phase and evidence counter, page links, upstream call count, and Docker health.
