# PDFit 0.4.5 release validation plan — 2026-11-09

## Goal

Release the public PDFit `0.4.5` (standalone cover view, launcher fix, aborted-read
crash fix) as Git tag `v0.4.5` and a GitHub release.

## Steps

1. Bump root, `apps/pdfit`, `apps/pdfit/docker`, `packages/pdfit`, their lockfile
   entries, the YES24 User-Agent, and install commands in docs to `0.4.5`.
   Private `apps/service` and `packages/service_domain` stay at their own versions.
2. Add `release-contracts/pdfit/v0.4.5.json` with the current PDFGPU pin; add the
   CHANGELOG entry.
3. `npm run build`, `npm run verify:repo`.
4. Back up the database, `npm run deploy:standalone`, compare per-table row counts.
5. Cover view and aborted-read checks against `http://127.0.0.1:15203`.
6. Commit, tag `v0.4.5`, push.
7. Install the launcher from `https://github.com/hikaMaeng/PDFit.git#v0.4.5` in an
   empty folder and run it against an isolated Compose project.
8. Create the GitHub release from the CHANGELOG entry.

## Expected result

- Standalone container healthy, reports `0.4.5`, row counts unchanged.
- The tag install starts a working standalone service from the chosen folder.
