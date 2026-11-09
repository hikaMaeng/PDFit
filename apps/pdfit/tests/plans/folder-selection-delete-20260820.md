# Folder selection delete validation

## Goal

Verify that a folder exposes row selection, select-all state, and a guarded
multi-file delete action without changing unrelated library files.

## Environment

* Root `docker-compose.yml` PDFit service
* Chromium through the in-app browser
* Two uniquely named temporary PDF fixtures on an isolated temporary Docker volume

## Steps

1. Build the shared PDFit frontend.
2. Deploy the PDFit container through the root Compose entry point.
3. Mount an isolated temporary library volume and upload two temporary PDFs to
   its root through the API.
4. Open the folder route and select both rows with their checkboxes.
5. Assert the **선택 삭제 (2)** button and the two-file confirmation message.
6. Confirm deletion and assert both rows disappear.
7. Cancel the browser confirmation without deleting data through Browser, then
   exercise the same two delete API contracts and assert neither PDF remains.
8. Exercise the select-all checkbox on a non-destructive fixture state and
   verify its indeterminate and cleared states.
9. Inspect the browser console for errors, restore the original library volume,
   and remove the isolated test volume.

## Pass criteria

The selected count is accurate, deletion requires confirmation, both fixture
files disappear from UI and API state, selection clearing works, the original
library is restored, and no browser error is emitted.
