# Internals

## Decisions

* One app owns both product capability sets so feature availability cannot drift between Free and Pro artifacts.
* One PostgreSQL pool stores both viewer metadata and application settings, while table names keep their bounded concerns.
* Legacy `pro_settings` data is copied into `app_settings` during schema setup to avoid losing existing settings during cutover.
* Docker remains the runtime boundary; the host build produces `apps/pdfit/dist` first.
