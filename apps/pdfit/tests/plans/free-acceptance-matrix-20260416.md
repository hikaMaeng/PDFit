# Test Plan: free-acceptance-matrix
## Created
2026-04-16
## Goal
Run the Free-only acceptance matrix against `http://127.0.0.1:15201` and record browser/API evidence in Markdown.
## Environment
Windows PowerShell, `F:\dev\pdfit`, local Docker Compose, Playwright Chromium headless.
## Preconditions
* `npm run deploy:free` completed successfully
* `npm run verify:free` passed
* Free container is reachable on `http://127.0.0.1:15201`
## Steps
1. Run `npm run verify:free:acceptance`
2. Verify each selected case starts from a hard reset
3. Capture any failure screenshot under `apps/free/tests/reports/free-acceptance-matrix/shots`
4. Write the report to `apps/free/tests/reports/free-acceptance-matrix/YYYYMMDD_HHMMSS.md`
## Expected Results
* CLI accepts `--case`, `--group`, `--base-url`, and `--report`
* Cases cover Free UI, viewer UI, API purges, and SSE refresh
* The report records pass/fail status, docker evidence, and uncovered risk
## Logs To Capture
* command line output
* report Markdown
* screenshot files for failed cases
* docker compose ps output for `pdfit-free`
