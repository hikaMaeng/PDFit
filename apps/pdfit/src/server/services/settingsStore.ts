import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { aiModelQueueKey, chatCompletionsUrl, type EmbeddingEndpoint } from '@pdfit/pdfit/server';
import { AI_MODEL_DEFAULT_TIMEOUT_MINUTES, AI_MODEL_MAX_TIMEOUT_MINUTES } from '@pdfit/pdfit/common/protocol/ai-model';
import type { DefaultAiModels, EmbeddingModel, LanguageModelCandidate, ModelChoice } from '@pdfit/pdfit/common/protocol/embedding-search';

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
  ocrConcurrency: number;
  requestTimeoutMinutes: number;
  botContextTokens: number | null;
  llmCandidates: LanguageModelCandidate[];
  embeddingCandidates: EmbeddingModel[];
  connectionVersion: string;
  created_at: number;
  updated_at: number;
}

export interface AiServerInput {
  name: string;
  type: AiServerType;
  url: string;
  headers?: Record<string, string>;
  models?: AiServerModels;
  ocrConcurrency?: number;
  requestTimeoutMinutes?: number;
  botContextTokens?: number | null;
  llmCandidates?: LanguageModelCandidate[];
  embeddingCandidates?: EmbeddingModel[];
}

// Multiple Settings entries can point to the same upstream with different model roles.
export function aiServerConcurrency(servers: readonly AiServer[], baseUrl: string): number | undefined {
  if (!URL.canParse(baseUrl)) return undefined;
  const endpoint = aiModelQueueKey(chatCompletionsUrl(baseUrl));
  let limit: number | undefined;
  for (const { url, ocrConcurrency } of servers) {
    if (URL.canParse(url) && aiModelQueueKey(chatCompletionsUrl(url)) === endpoint) {
      limit = Math.min(limit ?? ocrConcurrency, ocrConcurrency);
    }
  }
  return limit;
}

export class ActiveModelConflict extends Error {}

export function candidatesWithIds<T extends { id?: string }>(candidates: T[] | undefined): string {
  return JSON.stringify((candidates ?? []).map((candidate) => ({ ...candidate, id: candidate.id || randomUUID() })));
}

export class PostgresSettingsStore {
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
      ALTER TABLE ai_servers ADD COLUMN IF NOT EXISTS ocr_concurrency INTEGER NOT NULL DEFAULT 1
        CHECK (ocr_concurrency > 0)
    `);
    await this.pool.query('ALTER TABLE ai_servers ADD COLUMN IF NOT EXISTS bot_context_tokens INTEGER');
    await this.pool.query(`
      ALTER TABLE ai_servers ADD COLUMN IF NOT EXISTS request_timeout_minutes INTEGER NOT NULL DEFAULT ${AI_MODEL_DEFAULT_TIMEOUT_MINUTES}
        CHECK (request_timeout_minutes BETWEEN 1 AND ${AI_MODEL_MAX_TIMEOUT_MINUTES})
    `);
    await this.pool.query(`ALTER TABLE ai_servers ADD COLUMN IF NOT EXISTS llm_candidates JSONB,
      ADD COLUMN IF NOT EXISTS embedding_candidates JSONB NOT NULL DEFAULT '[]',
      ADD COLUMN IF NOT EXISTS connection_version UUID NOT NULL DEFAULT gen_random_uuid()`);
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

  async listAiServers(db: Pool | PoolClient = this.pool, id?: number): Promise<AiServer[]> {
    const servers = await db.query(`
      SELECT s.*, COALESCE((SELECT jsonb_object_agg(role, model_name) FROM ai_server_models WHERE server_id = s.id), '{}') AS models
      FROM ai_servers s WHERE ($1::bigint IS NULL OR s.id = $1) ORDER BY s.id
    `, [id ?? null]);
    return servers.rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      type: row.type,
      url: row.url,
      headers: row.headers ?? {},
      models: row.models,
      llmCandidates: row.llm_candidates ?? (row.models.llm?.trim() ? [{ id: `legacy-${row.id}`, name: row.models.llm }] : []),
      embeddingCandidates: row.embedding_candidates,
      connectionVersion: row.connection_version,
      ocrConcurrency: row.ocr_concurrency,
      requestTimeoutMinutes: row.request_timeout_minutes,
      botContextTokens: row.bot_context_tokens,
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
          INSERT INTO ai_servers (name, type, url, headers, ocr_concurrency, request_timeout_minutes, bot_context_tokens, llm_candidates, embedding_candidates)
          VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)
          RETURNING id
        `,
        [input.name, input.type, input.url, JSON.stringify(input.headers ?? {}), input.ocrConcurrency ?? 1,
          input.requestTimeoutMinutes ?? AI_MODEL_DEFAULT_TIMEOUT_MINUTES, input.botContextTokens ?? null,
          input.llmCandidates ? candidatesWithIds(input.llmCandidates) : null, candidatesWithIds(input.embeddingCandidates)],
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
      const defaults = await this.lockDefaults(client);
      const [before] = await this.listAiServers(client, id);
      if (!before) {
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
      if (input.ocrConcurrency !== undefined) {
        fields.push(`ocr_concurrency = $${fields.length + 1}`);
        values.push(input.ocrConcurrency);
      }
      if (input.requestTimeoutMinutes !== undefined) {
        fields.push(`request_timeout_minutes = $${fields.length + 1}`);
        values.push(input.requestTimeoutMinutes);
      }
      if (input.botContextTokens !== undefined) {
        fields.push(`bot_context_tokens = $${fields.length + 1}`);
        values.push(input.botContextTokens);
      }
      if (input.llmCandidates !== undefined) {
        fields.push(`llm_candidates = $${fields.length + 1}::jsonb`);
        values.push(candidatesWithIds(input.llmCandidates));
      }
      if (input.embeddingCandidates !== undefined) {
        fields.push(`embedding_candidates = $${fields.length + 1}::jsonb`);
        values.push(candidatesWithIds(input.embeddingCandidates));
      }

      if (fields.length > 0) {
        values.push(id);
        await client.query(
          `UPDATE ai_servers SET ${fields.join(', ')}, connection_version = gen_random_uuid(),
            updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id = $${values.length}`,
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

      const [after] = await this.listAiServers(client, id);
      if (defaults.llm?.serverId === id && !after.llmCandidates.some((candidate) => candidate.id === defaults.llm?.modelId)) {
        throw new ActiveModelConflict('Choose another default LLM or clear the selection');
      }
      if (defaults.embedding?.serverId === id) {
        const oldModel = before.embeddingCandidates.find((candidate) => candidate.id === defaults.embedding?.modelId);
        const newModel = after.embeddingCandidates.find((candidate) => candidate.id === defaults.embedding?.modelId);
        if (!oldModel || !newModel || before.url !== after.url || before.type !== after.type || JSON.stringify(before.headers) !== JSON.stringify(after.headers)
          || Object.keys(oldModel).some((key) => key !== 'embeddingConcurrency' && oldModel[key as keyof EmbeddingModel] !== newModel[key as keyof EmbeddingModel])) {
          throw new ActiveModelConflict('Choose another default embedding model or clear the selection');
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
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const defaults = await this.lockDefaults(client);
      if (defaults.llm?.serverId === id || defaults.embedding?.serverId === id) throw new ActiveModelConflict('Clear the active model selections first');
      const result = await client.query('DELETE FROM ai_servers WHERE id = $1', [id]);
      await client.query('COMMIT');
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async lockDefaults(client: PoolClient): Promise<DefaultAiModels> {
    await client.query('SELECT singleton FROM embedding_control WHERE singleton FOR UPDATE');
    return this.defaultModels(client);
  }

  async defaultModels(db: Pool | PoolClient = this.pool): Promise<DefaultAiModels> {
    const { rows: [row] } = await db.query<{ llm: ModelChoice | null; llmExplicit: boolean; embedding: ModelChoice | null }>(`
      SELECT (s.value::jsonb) AS llm, s.key IS NOT NULL AS "llmExplicit", c.model_choice AS embedding
      FROM embedding_control c LEFT JOIN app_settings s ON s.key = 'default-llm-v1' WHERE c.singleton
    `);
    return row;
  }

  async selectLlm(client: PoolClient, choice: ModelChoice | null): Promise<void> {
    if (choice && !(await this.listAiServers(client, choice.serverId))[0]?.llmCandidates.some((model) => model.id === choice.modelId)) {
      throw new ActiveModelConflict('LLM candidate no longer exists');
    }
    await client.query(`INSERT INTO app_settings(key, value) VALUES ('default-llm-v1', $1)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value`, [JSON.stringify(choice)]);
  }

  async embeddingEndpoint(choice: ModelChoice, db: Pool | PoolClient = this.pool): Promise<(EmbeddingEndpoint & { version: string }) | null> {
    const [server] = await this.listAiServers(db, choice.serverId);
    const model = server?.embeddingCandidates.find((candidate) => candidate.id === choice.modelId);
    return model ? { model, baseUrl: server.url, headers: server.headers, version: server.connectionVersion } : null;
  }

  async resolveLlm(servers?: AiServer[]): Promise<AiServer | null> {
    const settings = await this.defaultModels();
    servers ??= await this.listAiServers();
    if (!settings.llmExplicit) {
      const server = servers.find((candidate) => candidate.llmCandidates.length > 0);
      return server ? { ...server, models: { ...server.models, llm: server.llmCandidates[0].name } } : null;
    }
    const server = servers.find((candidate) => candidate.id === settings.llm?.serverId);
    const model = server?.llmCandidates.find((candidate) => candidate.id === settings.llm?.modelId);
    return server && model ? { ...server, models: { ...server.models, llm: model.name } } : null;
  }
}
