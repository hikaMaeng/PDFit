# PDF color and cover-view test plan

## Goal

Verify that PDFium preserves RGB channels and that a folder can switch between the existing list and a lazy first-page cover grid.

## Environment

Windows 11, Docker Desktop, Chromium/Playwright, PDFit service on port 15201.

## Steps

1. Build the shared package and both application variants.
2. Assert that the pinned PDFium integration renders native BGRA output and converts it to RGBA exactly once.
3. Open a folder fixture, switch to cover view, and verify that one cover card appears.
4. Switch back to list view and verify the grid is detached.
5. Build and start the service Docker container, then verify HTTP 200 and no browser console errors.

## Expected result

Color channels are not reversed, cover rendering is lazy, both views remain usable, and Docker stays healthy.
