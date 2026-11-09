# Home library link validation

## Goal

Verify that the home-page **라이브러리 열기** button targets the runtime's
actual root folder instead of a hard-coded folder name.

## Steps

1. Build the shared frontend and integrated PDFit application.
2. Deploy through the root `docker-compose.yml` entry point.
3. Open the home route and wait for the folder metadata request.
4. Assert the button href encodes the folder whose API row has `isRoot: true`.
5. Activate the button and assert the browser reaches that folder page.
6. Confirm the folder heading and PDF rows are visible without browser errors.

## Pass criteria

The button resolves the current root folder dynamically, respects the configured
navigation guard, and opens the root library successfully.
