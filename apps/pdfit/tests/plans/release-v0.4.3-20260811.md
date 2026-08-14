# PDFit 0.4.3 release validation plan

## Scope

- Synchronize root, shared package, app, Docker runtime package, and lockfile
  versions to `0.4.3`.
- Preserve the exact `@pdfgpu/core@0.1.9` release-contract pin.
- Release bidirectional bookmark synchronization and its reusable cross-window
  message router without including unrelated dirty files.

## Validation

1. Run release-contract, repository, package, and integrated build checks.
2. Commit only release-scoped version, contract, changelog, documentation, and
   plan/report files.
3. Push the release commit to `origin/master`.
4. Deploy through `npm run deploy` and verify Compose health and port `15201`.
5. Verify `/app/package.json` reports `0.4.3`, the library bind is visible, and
   headless Chromium renders sidebar version `v0.4.3` without browser errors.
