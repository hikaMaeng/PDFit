# Test Plan: free-entry-split-refactor
## Created
2026-04-16

## Goal
Verify that Free builds and deploys with separate service/viewer entries while excluding all Pro settings code and APIs.

## Environment
* Workspace: `F:\dev\pdfit`
* OS: Windows
* Shell: PowerShell
* Browser automation: Playwright Chromium headless

## Preconditions
* `npm install` completed for the workspace
* Docker Desktop is running
* `apps/free/.env` points `SERVER_PORT=15201`
* Verification runs against the locally deployed `pdfit-free` service

## Steps
1. Run `npm run build`.
2. Confirm `apps/free/dist/index.html` and `apps/free/dist/viewer/index.html` exist.
3. Confirm `apps/free/dist/server/routes/settings.js` does not exist.
4. Run `npm run deploy`.
5. Run `npm run verify:free`.
6. Record bundle-level checks for service/viewer manifest entries and browser results.

## Expected Results
* Free front build emits separate service and viewer entries.
* Free runtime serves `/` and `/viewer` independently.
* Free dist contains no `/api/settings` server artifact.
* Browser verification passes without Settings navigation in either Free entry.

## Logs To Capture
* `npm run build`
* `npm run deploy`
* `npm run verify:free`
* Relevant Docker compose output for `pdfit-free`
