# Untagged after upload

- Environment is Windows, the Free Docker service on loopback port 15203, PostgreSQL, and headless Chrome.
- Run `node --test packages/pdfit/tests/upload-index-order.test.mjs` after the shared build. Pause the full filesystem snapshot after reading the old file sizes. Reupload the same PDF while the scan is held. The upload and untagged query must return the new size before the scan is released. Check that the resumed scan preserves that size and indexes an external PDF.
- Run `apps/pdfit/tests/untagged-upload-browser.mjs` against the deployed Free service. Use a unique temporary test folder. Delay the multipart request and the tag summary, then open Untagged. The page should render without waiting for the tag summary. Release the upload and check the upload response, the untagged API row, and the document rendered by the open page without a manual refresh.
- Use `upload-pdf`, `lnb-untagged`, `untagged-title`, and `pdf-filename-line` as browser locator contracts. Capture the API result, a screenshot, and browser errors. Remove the temporary fixture after the run.
