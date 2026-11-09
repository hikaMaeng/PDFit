# PDF list click target and tag feedback

## Goal

Verify that only the PDF title communicates and performs detail-view navigation and that tag mutations provide immediate, observable feedback.

## Steps

1. Build the shared package and integrated PDFit app.
2. Deploy through the root Docker Compose entry point.
3. Open a populated folder and inspect the first PDF row.
4. Verify the title link uses a pointer cursor and has a descriptive detail-view title.
5. Verify the icon, metadata, tags, blank row area, and action controls do not trigger detail navigation.
6. Open tag management and verify the dialog appears immediately.
7. Verify add/delete handlers update visible tags before awaiting the server, disable conflicting controls while pending, show pending/success/error messages, and roll back on failure.
8. Check the production artifact, browser console, and container health.

## Expected result

- Only the PDF title opens PDF details.
- Only the title and independent action controls show pointer cursors.
- Tag management never appears unresponsive during initial load or mutation.
- Every mutation has pending and completion feedback, with failure rollback.
