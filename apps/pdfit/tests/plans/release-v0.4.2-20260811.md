# PDFit 0.4.2 release validation plan

## Scope

- Synchronize the repository, shared package, app, Docker runtime package, and
  lockfile versions to `0.4.2`.
- Preserve the exact `@pdfgpu/core@0.1.9` release-contract pin.
- Release the bookmark new-window page-navigation fix after `0.4.1` without
  including unrelated dirty files or pushing the local commits.

## Validation

1. Run the release-contract, repository, package, and integrated build checks.
2. Commit only release-scoped version, contract, changelog, documentation, and
   plan files.
3. Deploy through `npm run deploy` and verify Compose health and port `15201`.
4. Verify `/app/package.json` reports `0.4.2` and the library bind is visible.
5. Run headless Chromium against the deployed root page and verify the rendered
   sidebar displays `v0.4.2` without console or page errors.
