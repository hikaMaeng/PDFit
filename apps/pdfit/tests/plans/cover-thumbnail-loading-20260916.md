# Cover thumbnail loading

## Goal

Verify that PDF cover cards use a fast provider thumbnail, display immediate loading feedback, recover from a failed thumbnail through the PDF fallback, and make retry visibly responsive.

## Environment

- Windows 11
- Node.js browser fixture with Playwright Chromium
- Production PDFit frontend bundle
- Docker Compose service deployment

## Steps

1. Open a folder containing eight remote PDF records in cover view.
2. Return provider thumbnails for seven records and fail the eighth provider thumbnail.
3. Verify the failed provider thumbnail falls back to PDF rendering.
4. Fail that PDF request and verify a retry control appears.
5. Click retry and verify the loading placeholder appears immediately.
6. Return a successful provider thumbnail and verify all covers become visible.
7. Reload and verify cached thumbnails avoid later PDF downloads.
8. When Drive has no provider thumbnail, render the first page once and persist a small JPEG cover in the user's hidden PDFit system assets.
9. Reload and verify the generated Drive cover replaces the large-PDF fallback.
10. Build and deploy the service container and confirm it is healthy.
11. Delay a PDF fallback beyond four seconds and verify it says the cover is still being prepared rather than presenting a failure.
12. Fail the fallback and verify the card says the cover could not be displayed while the PDF can still be opened.

## Pass criteria

- Retry produces immediate visible feedback.
- Successful provider thumbnails avoid PDF content downloads.
- Provider failure retains the existing PDF renderer as a fallback.
- A successful fallback is persisted without modifying the source PDF.
- Later visits retrieve at most one small image and do not reopen the PDF for that cover.
- The deployed service is healthy.
- Slow rendering and actual failure have distinct messages; neither implies that the source PDF is inaccessible.
