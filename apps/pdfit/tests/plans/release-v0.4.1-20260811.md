# PDFit 0.4.1 release validation plan

## Scope

- Synchronize the repository, shared package, app, Docker runtime package, and
  lockfile versions to `0.4.1`.
- Preserve the exact `@pdfgpu/core@0.1.9` release-contract pin.
- Ship the two commits after `v0.4.0` without including unrelated dirty files.

## Validation

1. Run `npm run verify:release-contract` and `npm run build`.
2. Run repository and integrated verification.
3. Commit and push only the release-scoped files to `origin/master`.
4. Deploy through `npm run deploy` and verify Compose health and port `15201`.
5. Run a headless browser smoke test against the deployed root page and record
   the report and screenshot paths.
