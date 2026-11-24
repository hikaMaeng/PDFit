# Viewer clip tool

## Environment

Free Docker preview with an isolated local library and PostgreSQL data directory.
Use headless Chromium in Korean at 1280 × 900. Seed separate three-page PDFs for
the default PDF.js viewer and `?engine=gpu`.

## Checks

1. Open each PDF. In **PDF 주석 도구**, verify that **클립** is the first button
   and starts inactive. Check the visible icon captions and absence of hover
   tooltips in the palette. Check **형광펜** and the upper toolbar.
2. Press **클립**. Assert that `aria-pressed` and `aria-expanded` are true,
   the associated **클립** list opens next to the palette, and the palette stays put.
   Drag less than eight pixels, then press **클립** again. Expect both states
   to turn off and zero writes.
3. Reopen and drag a rectangle inside the visible part of page 1. Verify the
   engine's drag preview. Hold the POST before forwarding it. Release the
   pointer and verify that capture is already off while the list stays open.
   Forward the request. Expect one POST with a valid rectangle, HTTP 201,
   and a decoded thumbnail from the returned record.
4. Drag again with capture off. Verify that there is still only one stored
   clip. Close the panel from its header, reopen with **클립**, and verify that
   the same card reappears and the tool is armed again.
5. In each engine, draw a highlight, toggle its button off, and click the
   highlight to select it. Exercise F04/F05 to verify that the clip overlay
   delete button remains clickable after capture ends.

## Evidence

Capture health, the request count, response status, saved page, browser errors,
and screenshots and traces for both engines. Exercise F04 and F05 only against
a dedicated acceptance library. Capture surface and drag preview test IDs
distinguish structural anchors between the two engines.
