# Library usability and paid AI test plan

1. Build the shared package, standalone app, and hosted service.
2. Verify list checkboxes render to the left of filenames.
3. Verify pending uploads show an explicit non-viewable status and are excluded from bulk AI tagging.
4. Verify list/cover switching and title auto-tagging in a browser fixture.
5. Verify AI metadata access accepts only an active ₩12,000 paid pass, not trial access.
6. Rebuild the root Docker service and verify health plus a browser smoke test.

Pass when builds and tests succeed, the container is healthy on port 15201, and the browser reports no console errors.
