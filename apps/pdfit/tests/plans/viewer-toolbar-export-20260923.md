# Viewer toolbar and PDF export browser test

## Goal

Verify the authenticated PDF viewer exposes the requested toolbar order and behavior, uses a cursor icon with the `선택·이동` label, and offers only direct PDF download from the export dialog.

## Steps

1. Open a mocked authenticated PDF viewer in Korean.
2. Verify the order: page indicator, single page, double page, continuous scroll, fit width, fit height, zoom controls.
3. Enter a custom zoom percentage and verify it is applied.
4. Toggle continuous scrolling on and off.
5. Verify fit width is a momentary action without pressed state.
6. Verify the select/move tool uses the cursor icon and shortened tooltip.
7. Verify the saved-content sidebar button changes only between `보관함 열기` and `보관함 닫기`, and its opened sidebar title is `보관함`.
8. Open export, verify Markdown/JSON/original-PDF choices are absent, and download through `내보내기`.

## Expected result

The toolbar controls behave independently as specified, and export downloads exactly one PDF without format choices or browser errors.
