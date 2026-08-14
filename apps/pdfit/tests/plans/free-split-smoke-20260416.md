# Test Plan: free-split-smoke
## Created
2026-04-16

## Goal
Verify that the Free app builds, deploys, serves the shared PDF workflow, and excludes all Pro settings artifacts.

## Environment
Windows PowerShell in `F:\dev\pdfit`, root compose file, local Docker engine, local Playwright runtime.

## Preconditions
`apps/free/.env` exists, `apps/pro/.env` exists, workspace dependencies installed, no manual edits inside `C:\Users\hika0\pdfit-release`.

## Steps
1. Run `npm run build:free`.
2. Run `npm run deploy:free`.
3. Open `http://127.0.0.1:15201` in a headless browser.
4. Confirm the app loads and the nav does not expose `Settings`.
5. Request `/api/settings/ai-servers` and confirm the route is absent.
6. Confirm `apps/free/dist/server/routes/settings.js` is absent.
7. Collect compose and container logs for `pdfit-free`.

## Expected Results
Free build succeeds, Free deploy refreshes only `pdfit-free`, browser load succeeds, settings UI is absent, settings API is absent, and runtime logs do not show PostgreSQL startup.

## Logs To Capture
`docker compose config`, `docker compose logs pdfit-free`, browser verification output, and build/deploy command results.
