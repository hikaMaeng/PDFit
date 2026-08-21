# Usage

`apps/pdfit` imports the shared client and server surfaces, then adds the Settings
UI and `/api/settings` router through the service extension points.

## PDF upload

Open a folder and either select one or more PDFs with the upload button or drag
the files onto the folder content area. A drop overlay confirms the target, and
non-PDF files are ignored with an error message.

Each PDF row has a selection checkbox. Select individual rows or use the
header checkbox, then choose **선택 삭제** to review the count and delete the
selected PDFs together. If only part of the request succeeds, failed rows stay
selected so the user can retry them.

The Docker runtime accepts files up to 2048 MB each by default. Set
`PDFIT_MAX_UPLOAD_MB` in the root `.env` to an integer from 1 through 10240 to
override the limit. Files over the configured limit receive HTTP 413 with a
clear message instead of an internal-server error.
