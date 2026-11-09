# Large PDF upload test plan

## Goal

Verify that a PDF larger than the former 200 MB limit can be uploaded through
the production browser UI and Docker service.

## Steps

1. Build and deploy the production `pdfit` container with the 2048 MB default.
2. Create a uniquely named 201 MiB sparse PDF test fixture.
3. Open the deployed folder page in Chromium.
4. Select the fixture through the real file input and wait for the upload API.
5. Assert HTTP 200 and the returned filename.
6. Delete only the uniquely named uploaded fixture and local temporary file.
7. Run repository and deployed-browser verification.

## Pass criteria

- The 201 MiB browser upload returns HTTP 200.
- The temporary uploaded file is removed after verification.
- The deployed container remains healthy.
