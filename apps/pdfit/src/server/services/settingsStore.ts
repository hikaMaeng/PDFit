import { Pool } from 'pg';

export type AiServerType = 'lm-studio' | 'openai-compat';

export interface AiServerModels {
  vision?: string;
  llm?: string;
  embedding?: string;
}

export interface AiServer {
  id: number;
  name: string;
  type: AiServerType;
  url: string;
  headers: Record<string, string>;
  models: AiServerModels;
  created_at: number;
  updated_at: number;
}

export interface AiServerInput {
  name: string;
  type: AiServerType;
  url: string;
  headers?: Record<string, string>;
  models?: AiServerModels;
}

export interface SettingsStore {
  ensureSchema(): Promise<void>;
  listAiServers(): Promise<AiServer[]>;
  createAiServer(input: AiServerInput): Promise<number>;
  updateAiServer(id: number, input: Partial<AiServerInput>): Promise<boolean>;
  deleteAiServer(id: number): Promise<boolean>;
  getPgVectorConfig(): Promise<{ user?: string; password?: string }>;
  savePgVectorConfig(config: { user?: string; password?: string }): Promise<void>;
}

export class PostgresSettingsStore implements SettingsStore {
  constructor(private readonly pool: Pool) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ai_servers (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'openai-compat',
        url TEXT NOT NULL,
        headers JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
        updated_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ai_server_models (
        id BIGSERIAL PRIMARY KEY,
        server_id BIGINT NOT NULL REFERENCES ai_servers(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        model_name TEXT NOT NULL DEFAULT '',
        UNIQUE(server_id, role)
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT '',
        updated_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
      )
    `);
    await this.pool.query(`
      DO $$
      BEGIN
        IF to_regclass('public.pro_settings') IS NOT NULL THEN
          INSERT INTO app_settings (key, value, updated_at)
          SELECT key, value, updated_at FROM pro_settings
          ON CONFLICT (key) DO NOTHING;
        END IF;
      END $$;
    `);
  }

  async listAiServers(): Promise<AiServer[]> {
    const servers = await this.pool.query(`
      SELECT id, name, type, url, headers, created_at, updated_at
      FROM ai_servers
      ORDER BY id
    `);
    const models = await this.pool.query(`
      SELECT server_id, role, model_name
      FROM ai_server_models
      ORDER BY server_id, role
    `);
    const byServer = new Map<number, AiServerModels>();

    for (const row of models.rows) {
      const current = byServer.get(Number(row.server_id)) ?? {};
      current[row.role as keyof AiServerModels] = row.model_name;
      byServer.set(Number(row.server_id), current);
    }

    return servers.rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      type: row.type,
      url: row.url,
      headers: row.headers ?? {},
      models: byServer.get(Number(row.id)) ?? {},
      created_at: Number(row.created_at),
      updated_at: Number(row.updated_at),
    }));
  }

  async createAiServer(input: AiServerInput): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `
          INSERT INTO ai_servers (name, type, url, headers)
          VALUES ($1, $2, $3, $4::jsonb)
          RETURNING id
        `,
        [input.name, input.type, input.url, JSON.stringify(input.headers ?? {})],
      );
      const id = Number(inserted.rows[0].id);

      for (const [role, modelName] of Object.entries(input.models ?? {})) {
        if (!modelName) {
          continue;
        }
        await client.query(
          `
            INSERT INTO ai_server_models (server_id, role, model_name)
            VALUES ($1, $2, $3)
            ON CONFLICT (server_id, role) DO UPDATE SET model_name = EXCLUDED.model_name
          `,
          [id, role, modelName],
        );
      }

      await client.query('COMMIT');
      return id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateAiServer(id: number, input: Partial<AiServerInput>): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const exists = await client.query('SELECT id FROM ai_servers WHERE id = $1', [id]);
      if (exists.rowCount === 0) {
        await client.query('ROLLBACK');
        return false;
      }

      const fields: string[] = [];
      const values: unknown[] = [];
      if (input.name !== undefined) {
        fields.push(`name = $${fields.length + 1}`);
        values.push(input.name);
      }
      if (input.type !== undefined) {
        fields.push(`type = $${fields.length + 1}`);
        values.push(input.type);
      }
      if (input.url !== undefined) {
        fields.push(`url = $${fields.length + 1}`);
        values.push(input.url);
      }
      if (input.headers !== undefined) {
        fields.push(`headers = $${fields.length + 1}::jsonb`);
        values.push(JSON.stringify(input.headers));
      }

      if (fields.length > 0) {
        values.push(id);
        await client.query(
          `UPDATE ai_servers SET ${fields.join(', ')}, updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id = $${values.length}`,
          values,
        );
      }

      if (input.models) {
        for (const [role, modelName] of Object.entries(input.models)) {
          await client.query(
            `
              INSERT INTO ai_server_models (server_id, role, model_name)
              VALUES ($1, $2, $3)
              ON CONFLICT (server_id, role) DO UPDATE SET model_name = EXCLUDED.model_name
            `,
            [id, role, modelName ?? ''],
          );
        }
      }

      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteAiServer(id: number): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM ai_servers WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async getPgVectorConfig(): Promise<{ user?: string; password?: string }> {
    const result = await this.pool.query(`
      SELECT key, value
      FROM app_settings
      WHERE key IN ('pgvector_user', 'pgvector_password')
    `);
    const config: { user?: string; password?: string } = {};

    for (const row of result.rows) {
      if (row.key === 'pgvector_user') {
        config.user = row.value;
      }
      if (row.key === 'pgvector_password') {
        config.password = row.value;
      }
    }

    return config;
  }

  async savePgVectorConfig(config: { user?: string; password?: string }): Promise<void> {
    const entries = Object.entries({
      pgvector_user: config.user,
      pgvector_password: config.password,
    }).filter(([, value]) => value !== undefined);

    for (const [key, value] of entries) {
      await this.pool.query(
        `
          INSERT INTO app_settings (key, value, updated_at)
          VALUES ($1, $2, EXTRACT(EPOCH FROM NOW())::BIGINT)
          ON CONFLICT (key) DO UPDATE
          SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
        `,
        [key, value],
      );
    }
  }
}
