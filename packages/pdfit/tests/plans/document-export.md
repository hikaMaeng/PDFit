# Document Export Test Plan

## Goal

Verify that the shared PDFIT viewer exports the original PDF without rewriting it and produces portable Markdown and JSON files containing the active document's tags, reading position, viewer state, annotations, bookmark comments, and bookmark images.

## Environment

- Windows 11 host
- Root Docker Compose runtime
- Chromium through Playwright
- A disposable PDF fixture in the isolated browser-test library

## Steps

1. Build the shared package and integrated application.
2. Run the document-export serialization tests.
3. Deploy the root `pdfit` Docker service and verify its health endpoint.
4. Open a PDF in the browser and select the header export action.
5. Verify the dialog exposes Original PDF, Markdown reading note, and JSON data.
6. Download each format and verify its filename, MIME type, and representative content.
7. Confirm browser console and page errors remain empty.
8. Confirm payment, privacy, terms, and refund surfaces are unchanged by the feature diff.

## Expected Result

All three formats download successfully, source PDFs remain unchanged, export controls are keyboard accessible, and no payment or legal-policy file is modified.
