# Outline loading and retry

Created 2026-11-28 KST.

## Setup

Deploy Free with `npm run deploy:standalone` in a separate Compose project on port 15237. Bind a test library and separate database and bookmark directories. Populate `OutlineFinal` with `storage.pdf`, `initialize.pdf` and `pdf-read.pdf` from [the PDF fixture builder](../../../../packages/pdfit/tests/fixtures/outlinePdf.mjs) with `outline: true`. Use `outline: false` for `scan.pdf`. Start with no stored outline. Use Chrome with WebGPU enabled.

## Scenarios

1. Stall `GET /api/outlines/OutlineFinal/storage.pdf`. Open the outline. After the storage request times out, the embedded chapter list appears.
2. Stall the initial outline `PUT` for the second copy. The embedded chapter list appears after the write times out.
3. Return 404 for the third copy's stored outline. Let the PDFGPU viewer finish loading the PDF. Open the outline and stall the temporary PDF.js request for that file. The dialog stops loading, shows an error, and offers **Retry**. Resume PDF requests and select **Retry**. The embedded outline appears and is saved. Open it again in a fresh browser context and verify the stored copy loads.
4. Seed one stored entry for `scan.pdf`. Stall its stored-outline GET and return 404 for YES24. The dialog offers **Retry** after the storage timeout and the unsuccessful PDF lookup. Resume requests and confirm that **Retry** shows the saved entry.
5. On port 15203, verify the repaired outline for `에이전틱 디자인 패턴.pdf`. Compare its chapter destinations with the print contents and the heading at each destination. Click three chapter entries and compare the viewer page numbers with the stored values.

## Evidence

Record `/health`, mounted fixture paths, browser errors, request timing, the error and recovered outline screenshots, and a Playwright trace. Open the `목차` dialog with `viewer-outline-open`. Read the list through `pdf-outline-list` and scope `pdf-outline-entry` to the dialog. Select `다시 시도` by its button name and read the page from the `페이지 번호` textbox.
