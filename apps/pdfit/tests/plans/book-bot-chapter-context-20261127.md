# Book Bot context test

Created 2026-11-27 KST.

## Test

Build Free with `npm run build:pdfit`, then run `node --test apps/pdfit/tests/ai-model-timeout.test.mjs packages/pdfit/tests/ocr.test.mjs`. The chapter test checks one request, the boundary pages, the selected OCR and clips, and streamed answer chunks. The fallback test covers a chapter comparison and incomplete or duplicate outline headings. A whole-book fixture above the old byte limit must use one request if the local Qwen token count fits. An oversized fixture must check each reduction call against the configured window.

For Docker, run `node apps/pdfit/tests/viewer-scan-browser.mjs --fixtures <booksDir>` and start an isolated Free instance with `npm run deploy:standalone`, the fixture directory and an empty PostgreSQL data directory. Check the published `/health` response and library mount. Seed 40 synthetic OCR pages for `Scan/Parallel.pdf` and set chapter boundaries at pages 8 and 22. Set the mock completion server to `qwen36-35b` and the Bot window to 150,000. Send chapter and whole-book questions to `POST /api/book-bot/turns`. Capture the upstream request count and the Bot stream through the saved event.
