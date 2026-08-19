# U-drive CIFS library deployment plan

## Objective

Verify that the Windows-mapped NAS library at `U:\이북` is exposed to the local Docker PDFit runtime as a read-only external CIFS volume and that deployment starts with the complete indexed library.

## Environment

- Windows 11 host with Docker Desktop
- NAS share mapped as `U:`
- Root `.env` containing the SMB endpoint and local-only credentials
- PDFit local runtime on `http://127.0.0.1:15201`

## Steps

1. Count PDF files recursively under `U:\이북` without modifying them.
2. Run `node scripts/ensure-docker-library-volume.mjs` and confirm that the host-local SMB proxy listens only on loopback.
3. Mount the configured external volume in a disposable container and count PDFs under the configured subpath.
4. Run `npm run deploy` and require successful scoped build, Docker replacement, health readiness, and automatic library refresh.
5. Confirm Docker health and compare the `/api/folders` aggregate count with the source count.
6. Open the root and `이북` folder routes in a browser, confirm folder counts and PDF links, and inspect browser warnings/errors.

## Pass criteria

- Source, Docker mount, API index, and browser library all expose 717 PDFs.
- The `pdfit` container is healthy.
- The SMB proxy is listening on `127.0.0.1:1445`.
- Browser verification reports no warnings or errors.
- NAS credentials are never printed or committed.
