# AI title auto-tagging test plan

## Goal

Verify that a PDF filename becomes a safe book title, an OpenAI-compatible model returns bounded tags, existing tags are excluded, and the remaining tags are persisted through the shared metadata route in both local and hosted wiring.

## Automated coverage

1. Build `@pdfit/pdfit`, `pdfit`, and `service` TypeScript outputs.
2. Run `node --test packages/pdfit/tests/ai-tagging.test.mjs`.
   Verify local and hosted runtimes resolve the same three `SERVICE_AI_*` values through the shared parser.
3. Build the root Docker Compose services.
4. Open the running PDFit application with Playwright and verify each book row exposes a directly discoverable `AI 자동 태그` action.
5. Open a book's tag dialog and verify its secondary `AI 자동 태그` action remains visible and actionable.
6. Run `AI 일괄 태그`, confirm the folder-wide prompt, and verify one folder API request produces one metadata batch plus completion feedback.
7. Run without remote AI environment values and verify the shared local title classifier supplies tags instead of returning HTTP 503.
8. Confirm health endpoints and container logs remain clean.

## Failure reproduction

Capture the command, exit code, response body, container logs, browser URL, and screenshot for any failure.
