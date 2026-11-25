# PDF library file operations

Created 2026-11-25 (KST).

## Goal

Free list and tag changes follow the PostgreSQL commit when the SMB operation is delayed. Disk work survives process restart and preserves files written at conflicting paths.

## Environment and preconditions

- Build the shared server. Point `PDFIT_TEST_DATABASE_URL` at an isolated PostgreSQL 17 database with `pgcrypto` preinstalled for concurrent test runs.
- Before deploying Free, take and verify a PostgreSQL backup. Use the documented `deploy:standalone` entrypoint.
- Use a temporary PDF and folder for file changes on SMB. Verify the known stale book's physical path is absent before sending its metadata cleanup through the normal delete route.

## Steps and expected results

1. Run `node --test packages/pdfit/tests/library-file-operations.test.mjs`. Hold the disk step and verify rename, move and delete responses and list changes. Check tags, comments, the new read URL, duplicate admission, conflicting upload, and a concurrent full scan.
2. Simulate SMB failure and recreate the task scheduler. Verify that the saved operation is retried and that the final file and PostgreSQL layout agree. Verify that a destination conflict preserves both files and restores the source projection. Verify that replacing a source externally during a pending delete preserves the replacement and updates the index.
3. On deployed Free, check Docker health and the published health URL. Use browser controls to rename and delete a temporary PDF and check the list after each API response. Check move on the CIFS volume and ensure fixtures and pending operations are drained.
4. Search for the reported stale PDF in its original folder. Verify it is absent from the folder UI and server list after applying the delete request to its stale record.

## Evidence

Record test counts, Docker health, status API, observed deletion/rename/move responses, and browser screenshots. Use `pdf-search-button`, `pdf-search-input`, and the row action labels/test IDs for the target PDF. Use the delete dialog's role and confirmation button.
