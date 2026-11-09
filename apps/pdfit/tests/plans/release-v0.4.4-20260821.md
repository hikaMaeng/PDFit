# PDFit 0.4.4 release validation plan

## Goal

Validate that the viewer and library usability fixes ship as PDFit `0.4.4` across every workspace, runtime, release contract, Docker image, and browser surface.

## Steps

1. Align root, app, package, runtime, internal dependency, lockfile, documentation, and release-stage versions to `0.4.4`.
2. Add and verify the immutable `release-contracts/pdfit/v0.4.4.json` contract.
3. Build all Turbo packages.
4. Rebuild and recreate the PDFit container through the root compose entry point.
5. Run integrated artifact and release-contract verification.
6. Verify `/app/package.json`, container health, browser version text, browser asset hash, and console errors.

## Expected result

- Every active package reports `0.4.4` with exact internal dependency versions.
- The complete monorepo builds.
- The deployed container is healthy and reports `0.4.4`.
- The browser renders `v0.4.4` without console errors.
