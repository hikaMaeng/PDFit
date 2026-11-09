# PDF drag-and-drop upload test plan

## Goal

Verify that a folder accepts one or more PDF files dropped from the desktop,
shows a clear drop target, uploads the files, and refreshes the PDF list.

## Environment

- Windows 11 host
- Docker Compose `pdfit` service
- Chromium through Playwright
- `http://127.0.0.1:15201`

## Steps

1. Build the shared PDFit package and production application.
2. Rebuild and recreate the `pdfit` Docker service.
3. Seed an empty `uploads` folder through the acceptance runtime.
4. Open the folder in Chromium.
5. Dispatch a file drag containing two generated PDF fixtures.
6. Confirm that the drop overlay becomes visible before dropping.
7. Drop both files and wait for the refreshed list.
8. Confirm both filenames and the `PDF 2` count are visible.
9. Run repository and deployed-service verification.

## Pass criteria

- The production build and Docker deployment succeed.
- The drag overlay is visible during the drag.
- Both PDFs appear after the drop without using the file input.
- Repository and runtime browser checks pass.
