# Book clip count test plan

Created 2026-11-23.

## Goal and environment

Verify stored counts and eleven compact graphics using the Free PostgreSQL
runtime and desktop and mobile Chromium. Keep a pre-migration dump of the
book, clip and schema-migration tables.

## Steps and expected results

1. Run `book-clip-counts.test.mjs` with `PDFIT_TEST_DATABASE_URL`. The isolated
   schema verifies one-time backfill, unchanged counts after memo edits, atomic
   inserts and deletes, and clips saved before book indexing.
2. Deploy Free. Compare saved clip counts with the book rows and existing clip
   IDs and memos with the baseline. Confirm the library volume inside Docker
   and check the loopback and LAN health URLs.
3. Exercise 0 through 11 through fixture book-list responses. Check the
   distinct graphics, readable exact count, and identical icon footprint at
   desktop and mobile widths. Book cover rendering must issue no count requests.
4. Add a temporary clip to an indexed book. Open its gallery and delete that
   clip. Check the returned count, the updated icon in two browser windows,
   and preservation of the original clip list.

## Evidence and locators

Use `pdf-cover-clips`, its `data-clip-graphic` and accessible description,
`book-clips-dialog` and `bookmark-library-card`. Save the icon strip and browser
screenshots, network observations, database comparison and container health.
