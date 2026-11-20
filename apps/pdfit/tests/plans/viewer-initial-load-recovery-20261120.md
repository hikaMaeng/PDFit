# Initial PDF load recovery test plan

## Created

2026-11-20 KST

## Goal

Recover when a Free viewer opens during a temporary library 503. Preserve the missing-document response and avoid tripping the volume guard when a healthy directory has many files.

## Environment and steps

1. Build and run an isolated Free Docker instance with `npm run deploy:standalone` on loopback port 15235. Mount the `OutlineFixture/original.pdf` fixture from the [outline management plan](viewer-outline-management-20261120.md).
2. Run `node --test packages/pdfit/tests/library-volume-guard.test.mjs`. Verify folder counts use directory entries, slow cumulative scans remain available, and a hung request still triggers the guard.
3. Run `node apps/pdfit/tests/viewer-initial-load-recovery-browser.mjs`. Inject two 503 responses and verify automatic rendering. Keep returning 503 through the retry budget, then restore the origin and use **다시 시도**. Return 404 and verify the missing-document message without retry.
4. Verify the normal LAN file path with HTTP `/health` and a ranged PDF request. Open the viewer and confirm the canvas and toolbar render.

## Evidence and locators

Capture health, HTTP status, injected request methods, page errors and screenshots. Use the visible retry status, the **다시 시도** button, the **목차** toolbar button and the PDF canvas.
