# Test plan for viewer document scan

Created 2026-11-24 KST.

## Environment

Use an isolated Free Docker instance with a fresh PostgreSQL data mount and an empty AI server list. Build the fixture library with `node apps/pdfit/tests/viewer-scan-browser.mjs --fixtures <books-directory>` and bind that directory into the container. Use the repository's `npm run deploy:standalone` entrypoint with a dedicated Compose project, loopback port and data/bookmark mounts. The fixture PDFs include embedded text, image-only OCR inputs, fractional file timestamps, and a 40-page PDF for the layout scenario.

Set `PDFIT_TEST_ORIGIN` to the instance's loopback URL and `PDFIT_TEST_OUTPUT` to an evidence directory. Run `node apps/pdfit/tests/viewer-scan-browser.mjs` with Chrome. The test starts a held-response vision fixture reachable from the container as `host.docker.internal` and adds and removes its AI server setting. `PDFIT_TEST_DOCKER_HOST` can override the host alias.

## Steps and expected results

Run `npm run test:ocr` for the held-vision regression. Two vision calls overlap while the first DB save blocks the scan result listener. A failed save stops further dispatch for that document and releases the listener for the next admitted result.

For scan diagnostics, the OCR tests also inject two upstream timeouts and check the recorded queue and request phases, first failure, drain and terminal state. Capture `docker logs --timestamps <fixture-container>` during the browser scenario. Match each `[ocr] scan` record to its job ID. Verify that an HTTP 502 records `vision-response`, that the first error stops dispatch, that admitted work drains, and that cancellation and successful retry produce distinct terminal results.

For the model deadline, build Free and run `node --test apps/pdfit/tests/ai-model-timeout.test.mjs`. Confirm that OCR, Bot, translation, and both automatic-tag configurations use 1,200,000 ms. The delayed HTTP fixture compares the AI transport with a short-deadline dispatcher and checks cancellation.

For a live concurrency change after an OCR timeout, read back the saved AI server setting, then resume the failed scan from its original start page. Check `page.dispatched` and `vision-request` for the new limit. Compare `/api/ocr/scan/pages` before and after to verify that previously indexed pages are reused and that the failed page is saved. Record the last observed scan status and the published `/health` result.

1. Create an AI server without a concurrency field. Confirm default 1, validation of limits, and persistence of an edit to 2 in Settings.
2. Read page 2 with regular OCR and verify its database status. In the viewer toolbar, check Scan before Contents and open the dialog. All five pages appear with 10 px numbers, contrasting colors, and accessible status names. The two legend labels and the single X share the title row. The X has a 5 px inset from the right edge. Closing with X returns focus to Scan.
3. Start on page 2. The toolbar shows `3,4 총 2건` while the start controls are hidden. Open the summary and confirm only pages 3 and 4 appear. Escape closes the dialog and restores focus to the summary. Move the reader to a different page while vision responses are held. A duplicate start returns the same job. Page 2 stays skipped and page 1 stays outside the scan range.
4. Start a second document in the GPU viewer. Its scan waits for global capacity and continues after the window closes. Reopen it and cancel while a page is in flight. The admitted page can save and later pages stay unsaved.
5. Return an AI error with two requests in flight. Confirm that dispatch stops for the affected document, admitted work drains, and the modal names the failed page. Retry with concurrency 1 and confirm that saved pages are skipped. A cancellation with the prior job ID leaves the new job running.
6. Open the page list at 320px and verify the toolbar fits and the legend stays on the same row as the title and X. Record browser page errors, maximum simultaneous AI calls, server health, mounted fixture files, and screenshots of Settings, progress, page status, failure, and mobile.
7. Remove the fixture AI server and start on an image-only page. Confirm the scan stops there and preserves already saved text.
8. Check the smaller whole-document percentage between Scan and the start page. Keep one OCR response pending and verify 20% changes to 60% after the first vision response and the embedded-text tail are saved. Check 80% after a scan that starts on page 2, 25% after cancellation, 33% after one page of a three-page PDF is saved, and 100% after all pages are saved. Check 0% on the second document and confirm the percentage fits at 320px.
9. At 320 px, replace scan status responses for the 40-page fixture with snapshots of 1, 4, and 32 active pages. Confirm the text `1,2… 총 4건`, open the dialog with Enter, and verify the exact square tiles for the four pages. Keep the dialog open while the snapshot changes to 32 pages. Confirm that the new tiles replace the old ones, the last tile is reachable by scrolling inside the dialog, and the toolbar summary has the same width and height at 1 and 32 pages. Reopen the summary and return a missing job. The dialog shows zero active pages and the start controls return after closing it.
10. In Scan status, press Enter on a saved page and click an unsaved page while its OCR request remains in flight. In WebGPU continuous scroll, hold the saved-status response, click page 35, and check that its page number and viewport position change before releasing the response. Return HTTP 503 for the same endpoint and select page 38. At 320 px, select page 5. Each selection closes the dialog.

## Browser locators

Use the localized names for the Scan status button, dialog and heading, the scan coverage meter, scan start page spinbutton, Start and Cancel buttons, and progress bar. Within Scan status, use the visible legend text and the named Close button. Each grid item contains a button named with the page number and saved-text status. While the status is unknown, use the localized `Go to page {page} in the viewer` button name. Find the in-flight summary by its visible button text and the live page tiles by list item role within the named `Pages in progress` dialog. The existing `viewer-outline-open` identifies Contents.
