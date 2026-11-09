# Folder row action alignment validation

## Goal

Verify that the tag, move, delete, and selection controls share the same
vertical center in every PDF row.

## Steps

1. Build and deploy PDFit through the root Compose entry point.
2. Open a populated folder in Chromium.
3. Read the first row's action-control bounding rectangles.
4. Compare the vertical center of all three icon buttons and the checkbox.
5. Repeat the comparison on multiple visible rows and inspect browser errors.

## Pass criteria

All four controls have the same vertical center, retain their horizontal order,
and produce no browser errors.
