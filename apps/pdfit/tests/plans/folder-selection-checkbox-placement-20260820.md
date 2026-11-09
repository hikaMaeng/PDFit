# Folder selection checkbox placement validation

## Goal

Verify that each PDF selection checkbox appears directly after the row delete
button while preserving selection behavior and readable file-row spacing.

## Steps

1. Build and deploy PDFit through the root Compose entry point.
2. Open a populated folder in Chromium.
3. Compare the horizontal positions of the row delete button and checkbox.
4. Assert the checkbox is to the right of the delete button.
5. Select one row and confirm the selected-delete count becomes one.
6. Clear the selection and inspect browser errors.

## Pass criteria

Every row checkbox is positioned after its delete button, selection behavior is
unchanged, row text does not overlap the action area, and no browser error occurs.
