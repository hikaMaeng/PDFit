# Verification And Evidence

Run, in order:

1. `npm run sync:pdfgpu`
2. `npm run verify:release-contract`
3. `npm run build`
4. `npm run verify:repo`
5. `npm run deploy`
6. `npm run verify:pdfit`
7. `npm run verify:pdfit:acceptance`
8. `npm run test:pdfgpu`

The sync report is `packages/pdfit/vendor/pdfgpu-build.json`. It must identify
the committed `@pdfgpu/core` source SHA, package version, and tarball SHA-256.
The immutable release record is selected from
`release-contracts/pdfit/v<PDFit-version>.json`; it must identify the same
PDFit and PDFgpu versions and is checked by the build and repository verification
commands.

Browser evidence belongs under `test/YYYYMMDD/<run>/`. Integrated app plans and reports belong under `apps/pdfit/tests/plans/` and `apps/pdfit/tests/reports/`.

The report must state the URL, whether the run was smoke or scenario based, Docker service health, artifact paths, and any host bind limitation. A healthy container alone does not prove that a mapped SMB library is visible inside Docker.
