# Test plan for viewer document scan

Created 2026-11-24 KST.

## Environment

Use an isolated Free Docker instance with a fresh PostgreSQL data mount and an empty AI server list. Build the fixture library with `node apps/pdfit/tests/viewer-scan-browser.mjs --fixtures <books-directory>` and bind that directory into the container. Use the repository's `npm run deploy:standalone` entrypoint with a dedicated Compose project, loopback port and data/bookmark mounts. The three fixture PDFs include embedded text, image-only OCR inputs, and fractional file timestamps.

Set `PDFIT_TEST_ORIGIN` to the instance's loopback URL and `PDFIT_TEST_OUTPUT` to an evidence directory. Run `node apps/pdfit/tests/viewer-scan-browser.mjs` with Chrome. The test starts a held-response vision fixture reachable from the container as `host.docker.internal` and adds and removes its AI server setting. `PDFIT_TEST_DOCKER_HOST` can override the host alias.

## Steps and expected results

Run `npm run test:ocr` for the held-vision regression. Two vision calls overlap while the first DB save blocks the scan result listener. A failed save stops further dispatch for that document and releases the listener for the next admitted result.

1. Create an AI server without a concurrency field. Confirm default 1, validation of limits, and persistence of an edit to 2 in Settings.
2. Read page 2 with regular OCR and verify its database status. In the PDF.js toolbar, check Scan before Contents and open the dialog. All five pages appear with contrasting saved and unsaved colors and accessible status names.
3. Start on page 2. The toolbar shows pages 3 and 4 together while the start controls are hidden. Move the reader to a different page while vision responses are held. A duplicate start returns the same job. Page 2 stays skipped and page 1 stays outside the scan range.
4. Start a second document in the GPU viewer. Its scan waits for global capacity and continues after the window closes. Reopen it and cancel while a page is in flight. The admitted page can save and later pages stay unsaved.
5. Return an AI error with two requests in flight. Confirm that dispatch stops for the affected document, admitted work drains, and the modal names the failed page. Retry with concurrency 1 and confirm that saved pages are skipped. A cancellation with the prior job ID leaves the new job running.
6. Open the page list at 320px and verify the toolbar fits. Record browser page errors, maximum simultaneous AI calls, server health, mounted fixture files, and screenshots of Settings, progress, page status, failure, and mobile.
7. Remove the fixture AI server and start on an image-only page. Confirm the scan stops there and preserves already saved text.
8. Check the smaller whole-document percentage between Scan and the start page. Keep one OCR response pending and verify 20% changes to 60% after the first vision response and the embedded-text tail are saved. Check 80% after a scan that starts on page 2, 25% after cancellation, 33% after one page of a three-page PDF is saved, and 100% after all pages are saved. Check 0% on the second document and confirm the percentage fits at 320px.

## Browser locators

Use the localized names for the Scan status button and dialog, the scan coverage meter, scan start page spinbutton, Start and Cancel buttons, and progress bar. The page grid exposes a list item for each page, named with its page number and saved-text status. The existing `viewer-outline-open` identifies Contents.
