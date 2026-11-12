# OCR browser test — fix run (0643919)

- Timestamp: 2026-11-12, after deploying 0643919
- Command: `PDFIT_TEST_CHANNEL=chrome PDFIT_TEST_STEPS=3a,4a,5 PDFIT_TEST_SKIP_VISION=1 PDFIT_TEST_RUN=20261112_fix-ocr-mobile node apps/pdfit/tests/ocr-browser.mjs`
- Evidence: `20261112_fix-ocr-mobile/result.json`

Re-runs the steps that failed or depend on the two fixes from `20261112_1748.md`.

| Step | Verdict |
| --- | --- |
| `2_find_digital_pdf` | PASS |
| `3a_page_ocr_digital` | PASS |
| `4a_clip_digital` | PASS |
| `5_page_ocr_dark_mobile` | PASS |
| `3b_page_ocr_scanned_cached` | SKIP |
| `3c_page_ocr_scanned_uncached` | SKIP |
| `4b_clip_scanned` | SKIP |

375 px page-OCR dialog: header lines heading 1, source 1, copy 1, retry 1 (before the fix 3/-/3/2). Page overflow 0, text overflow 0, source `text-layer`, 1350 chars, equal to the API: True.

Cleanup: clips at start 9, at end 9, matches baseline True.

Not covered: `ocr.updatedAt` as ISO 8601 was not observed on the live server. The run deletes its own clip, and no other clip carries OCR state. The fix is `isoTimestamp()` in `packages/pdfit/src/server/postgres/index.ts`. Vision steps 3b, 3c, 4b were skipped here; they passed in `20261112_1729_ocr` and `20261112_1746_ocr-3c`.
