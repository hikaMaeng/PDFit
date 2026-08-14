# Cutover And Migration

The repository was consolidated from two app modules into `apps/pdfit`.

1. Move the Free base entrypoints, Docker assets, docs, and tests into `apps/pdfit`.
2. Merge the Pro settings UI, settings API, and PostgreSQL store into the same app.
3. Rename the runtime to `pdfit`, retain port `15201`, and remove the second Compose service.
4. Keep `/viewer` as a separate browser entry while serving it from the same Express process.
5. Verify the integrated artifact and migrate legacy metadata during startup.

Rollback is a Git revert of the consolidation commit plus restoration of the prior Compose service only after checking the PostgreSQL data directory backup. The old generated `apps/pro` runtime artifacts are not source inputs for the integrated build.
