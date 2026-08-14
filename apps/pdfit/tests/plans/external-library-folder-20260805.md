# External library folder validation

## Scope

Validate the configured external library target `S:\bside\이북` against the
integrated PDFit service, including root-file discovery, folder creation,
real-file operations, PDF opening, WebGPU viewer
rendering, navigation, zoom, color inversion, and return to
the folder list.

The Compose contract mounts `S:\bside\이북` itself as `/app/data/books`.
The application root label is `이북`; this label is an API alias for the real
mounted directory, not a second storage folder.

## Evidence and acceptance

1. Host filesystem contains the target directory and PDF files.
2. The service lists root `이북` and its PDF count.
3. A folder created through the service exists under the mounted root.
4. A root PDF can be moved into that folder, listed there, and deleted from disk.
5. A target PDF opens with the WebGPU viewer and reports its page count.
6. Page input navigation, zoom, and inversion
   submission work.
5. The viewer back action returns to `/folder/이북` and restores the PDF list.
6. Docker health remains green after the official deploy.

## Environment limitation

The deploy bridge uses the Docker-managed CIFS volume `linker-models`, whose
remote source is `\\192.168.0.13\file-station`. The container receives the
share at `/app/data/books` and the application selects its real root at
`/app/data/books/bside/이북`; credentials are kept in Docker volume metadata,
not in the repository.
