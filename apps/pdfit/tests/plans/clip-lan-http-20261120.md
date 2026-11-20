# Test plan for clip capture over LAN HTTP

## Created

2026-11-20

## Goal and environment

Use installed Google Chrome with a visible window and the standalone Docker service at its LAN HTTP address. Use a readable library PDF and a fresh browser profile. Leave Chrome's secure-origin settings at their defaults.

## Steps and expected results

1. Open `http://192.168.0.6:15203/viewer/` for `이북/Git for Teams.pdf`, page 3. Record `isSecureContext` and the availability of the two Web Crypto methods.
2. In the toolbar, click the button named `선택 영역 보관`. Drag a rectangle inside the visible PDF canvas in `legacy-bookmark-capture-surface`.
3. Before the fix, capture the error toast and verify that no clip save request leaves the browser. After the fix, expect a single `POST /api/bookmarks/:folder/:filename` with a UUID v4 operation ID and a `201` response.
4. Open `/bookmarks` in the same browser, locate the new image by its unique asset URL within `bookmark-library-page`, and click it. Confirm `bookmark-preview-image` loads with nonzero dimensions. Save screenshots and a browser trace.
5. Click `bookmark-preview-delete` for the test clip. Expect HTTP `204`, the card to disappear, and the clip ID to be absent from the server list. Intercept unrelated browser writes to preserve existing reader state.

Record the deploy result, Docker health, library mount, Chrome version, HTTP responses, browser errors, screenshot paths and cleanup result in the test report.
