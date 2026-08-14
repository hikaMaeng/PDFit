# Overview

`apps/pdfit` is the only deployable PDFit app. It combines the former Free library/viewer workflow with the former Pro Settings and pgvector workflow.

The service entry serves the library UI and `/api/*`; the viewer entry serves `/viewer` and uses the shared PDFium/WebGPU implementation with its fallback path.

The service shell keeps the library navigation (folders and tags), with Settings available as a gear icon in the upper-right header and without adding a secondary tab strip. Its visual contract follows the LinkCpp console surface: a fixed dark navigation rail, blue active-state accent, thin dividers, and a layered `#18181b` / `#202124` work area.

The service brand asset is `apps/pdfit/public/brand/pdfit-logo-dark.png`. The header and favicon must use this transparent PNG so the tested wordmark and overlap remain pixel-stable. Its visual contract is intentionally minimal: a filled blue document with white `PD`, overlapped by a short white panel containing black `Fit`; do not add an enclosing logo box or extra document modules.
