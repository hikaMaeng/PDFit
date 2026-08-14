#!/bin/bash
set -euo pipefail

PG_USER="${POSTGRES_USER:-books}"
PG_PASS="${POSTGRES_PASSWORD:-books}"
PG_DB="${PGDATABASE:-books}"

mkdir -p "$PGDATA"
chown -R postgres:postgres "$PGDATA"
chmod 700 "$PGDATA"

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "[pg] initdb $PGDATA"
  su -s /bin/bash postgres -c "initdb -D $PGDATA --auth-host=md5 --auth-local=trust --locale=C.UTF-8"
  echo "host all all 127.0.0.1/32 md5" >> "$PGDATA/pg_hba.conf"
fi

echo "[pg] starting postgres"
su -s /bin/bash postgres -c "pg_ctl -D $PGDATA -l $PGDATA/pg.log start -w"

su -s /bin/bash postgres -c "
  unset PGHOST PGPASSWORD PGUSER PGDATABASE PGPORT;
  psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='$PG_USER'\" | grep -q 1 \\
    || psql -c \"CREATE USER \\\"$PG_USER\\\" WITH PASSWORD '$PG_PASS';\"
  psql -tc \"SELECT 1 FROM pg_database WHERE datname='$PG_DB'\" | grep -q 1 \\
    || psql -c \"CREATE DATABASE \\\"$PG_DB\\\" OWNER \\\"$PG_USER\\\";\"
  psql -d \"$PG_DB\" -c 'CREATE EXTENSION IF NOT EXISTS vector;'
  psql -d \"$PG_DB\" -c 'CREATE EXTENSION IF NOT EXISTS textsearch_ko;' || true
"

su -s /bin/bash postgres -c "
  psql -d \"$PG_DB\" -c \"CREATE TABLE IF NOT EXISTS ai_servers (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'openai-compat', url TEXT NOT NULL, headers JSONB NOT NULL DEFAULT '{}'::jsonb, created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT, updated_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT);\"
  psql -d \"$PG_DB\" -c \"CREATE TABLE IF NOT EXISTS ai_server_models (id BIGSERIAL PRIMARY KEY, server_id BIGINT NOT NULL REFERENCES ai_servers(id) ON DELETE CASCADE, role TEXT NOT NULL, model_name TEXT NOT NULL DEFAULT '', UNIQUE(server_id, role));\"
  psql -d \"$PG_DB\" -c \"CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT);\"
  psql -d \"$PG_DB\" -c \"GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO \\\"$PG_USER\\\";\"
  psql -d \"$PG_DB\" -c \"GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO \\\"$PG_USER\\\";\"
"

echo "[pg] runtime ready on localhost:5432"
exec node /app/dist/server/index.js
