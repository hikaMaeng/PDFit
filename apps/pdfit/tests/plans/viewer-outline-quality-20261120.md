# Viewer outline quality test plan

## Created

2026-11-20 KST

## Goal

Use a usable embedded outline first. Resolve a missing or placeholder outline with the corresponding YES24 listing and verified physical PDF destinations. Preserve confirmed deletions and manual edits.

## Environment and preconditions

Use an isolated Free Docker project with loopback port 15234 and a separate PostgreSQL data mount. Mount local copies of the two reported PDFs under `OutlineQuality` with their original filenames. Mount the synthetic fixtures from [the outline management plan](viewer-outline-management-20261120.md) under `OutlineFixture`. The Bookstore lookup needs outbound HTTPS access to YES24.

## Steps and expected results

1. Run `npm run test:outline`. Supply an isolated PostgreSQL connection to cover cache replacement, manual numeric titles, and deletion.
2. Deploy the Free candidate with `npm run deploy:standalone` and verify Docker health and fixture visibility.
3. Run `node apps/pdfit/tests/viewer-outline-quality-browser.mjs`. MCP should display 33 titles, link 32 and leave the absent index unlinked. Compare all six chapter starts to their printed pages. SLM should display 64 linked entries, use the printed ISBN and land on PDF page 93 for section 7.1. Its preface must open page 7. Both books must reuse the saved outline after reload.
4. Run `node apps/pdfit/tests/viewer-outline-management-browser.mjs` on the same port with `PDFIT_TEST_ORIGIN=http://127.0.0.1:15234`. Verify embedded outlines, empty results, editing, regeneration and deletion.

## Evidence and locators

Capture the storefront status, saved entries and Chromium screenshots. Open the `목차` button, then use the named dialog and `pdf-outline-entry` rows. `pdf-outline-list[data-source]` distinguishes fresh generation from storage and `pdfgpu-scroll-area` identifies the GPU engine.
