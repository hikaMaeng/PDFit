# Test Plan — Recently added books

## Created

2026-11-27 KST

## Goal and environment

Verify Free's pinned folder entry with the standalone Docker app on port 15203,
Playwright Chromium, and an isolated schema in its embedded PostgreSQL 17.

## Steps and expected results

1. Apply the schema upgrade to an older catalog with valid and missing file
   modification times. Verify the old timestamp is carried over where known.
2. Index more than 30 books across folders. Verify the newest 30 are returned in
   registration order. Rescan with changed file metadata and move or rename a
   single PDF. Verify those operations preserve its registration time.
3. Open the standalone app in Korean. Assert the **신규등록** link precedes the
   first real folder and follows the section's collapse and expand control.
4. Select the link. Assert the heading, count, and visible book order match the
   API in list and cover modes. Reload the route directly and check the empty
   state in a separate browser context with an empty API response.
5. Use the page's refresh command and check the catalog read after it completes.

## Evidence and locators

Capture PostgreSQL assertions, Docker health, API status, and browser screenshots.
Use the **폴더** button and **신규등록** link and heading. Use
`recent-book-list`, `pdf-filename-line`, and `pdf-cover-card` for repeated books.
