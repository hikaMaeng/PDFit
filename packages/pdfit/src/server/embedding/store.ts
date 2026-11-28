import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { SEMANTIC_SCOPES, type ModelChoice, type SemanticHit, type SemanticScope } from '../../common/protocol/embedding-search/index.js';
import type { EmbeddingEndpoint } from './client.js';
import { CHUNK_VERSION, SOURCE_WINDOW, type Chunk } from './chunks.worker.js';
import { embeddingSchema, lookupSource } from './schema.js';

const PAGE = 100;
const MAX_PENDING = 2000;
const REF_TABLES = { 'page-ocr': 'book_page_ocr_search', 'clip-ocr': 'bookmarks', 'clip-memo': 'bookmarks', 'book-comment': 'book_comments' };

export interface ActiveIndex {
  profile: string;
  table: string;
  generation: string;
  choice: ModelChoice;
  blocked: string | null;
  retryAt: Date | null;
}
export interface Work { source: string; revision: string; scope: SemanticScope; refid: string; position: number; attempts: number; text: string; partial: boolean }
export interface ReservedWork { lease: string; jobs: Work[] }
export interface EmbeddedChunk { job: Work; chunk: Chunk; vector: number[] | null }

function quoteTable(table: string): string {
  if (!/^emb_[a-z0-9_]{1,26}_[0-9a-f]{24}$/.test(table)) throw new Error('Invalid embedding table name');
  return `"${table}"`;
}

function modelIdentity(choice: ModelChoice, endpoint: EmbeddingEndpoint) {
  const { name, dimensions, indexDimensions, documentPrefix, queryPrefix, maxInputTokens, revision } = endpoint.model;
  const profile = createHash('sha256').update(JSON.stringify([choice.serverId, endpoint.baseUrl, name, revision,
    dimensions, indexDimensions, documentPrefix, queryPrefix, maxInputTokens, CHUNK_VERSION])).digest('hex');
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 26) || 'model';
  return { profile, table: `emb_${slug}_${profile.slice(0, 24)}` };
}

export class EmbeddingStore {
  private iterativeScan = false;

  constructor(private readonly db: Pool) {}

  async ensureSchema(): Promise<void> {
    await this.db.query(embeddingSchema);
    const { rows: [version] } = await this.db.query<{ extversion: string }>("SELECT extversion FROM pg_extension WHERE extname = 'vector'");
    const [major, minor] = (version?.extversion ?? '0.0').split('.').map(Number);
    this.iterativeScan = major > 0 || minor >= 8;
  }

  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN; SET LOCAL statement_timeout = '3s'; SET LOCAL lock_timeout = '500ms'");
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async active(db: Pool | PoolClient = this.db): Promise<ActiveIndex | null> {
    const { rows: [row] } = await db.query<ActiveIndex>(`
      SELECT c.profile, p.table_name AS "table", c.generation, c.model_choice AS choice, c.blocked_error AS blocked,
        c.retry_not_before AS "retryAt"
      FROM embedding_control c JOIN embedding_profiles p ON p.profile = c.profile WHERE c.singleton
    `);
    return row ?? null;
  }

  async activate(client: PoolClient, choice: ModelChoice | null, endpoint: EmbeddingEndpoint | null): Promise<void> {
    const current = await this.active(client);
    if (!choice || !endpoint) {
      await client.query(`UPDATE embedding_control SET profile = NULL, model_choice = NULL, blocked_error = NULL, retry_not_before = NULL,
        generation = gen_random_uuid() WHERE singleton`);
      return;
    }
    const { profile, table } = modelIdentity(choice, endpoint);
    const identifier = quoteTable(table);
    const { name, dimensions, indexDimensions } = endpoint.model;
    await client.query('INSERT INTO embedding_profiles VALUES ($1,$2,$3) ON CONFLICT (profile) DO NOTHING', [profile, table, name]);
    const { rows: [relation] } = await client.query<{ existing: string | null }>('SELECT to_regclass($1)::text AS existing', [table]);
    if (!relation.existing) {
      await client.query(`CREATE TABLE ${identifier} (
        id UUID PRIMARY KEY, contents TEXT NOT NULL, ref TEXT NOT NULL, refid TEXT NOT NULL,
        embedding vector(${dimensions}) NOT NULL, hnsw vector(${indexDimensions}) NOT NULL
      ); CREATE INDEX "${table}_h" ON ${identifier} USING hnsw (hnsw vector_cosine_ops)`);
    }
    const { rowCount } = await client.query(`
      SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid JOIN pg_am am ON am.oid = idx.relam
      JOIN pg_opclass op ON op.oid = i.indclass[0]
      JOIN pg_attribute d ON d.attrelid = i.indrelid AND d.attname = 'embedding'
      JOIN pg_attribute h ON h.attrelid = i.indrelid AND h.attname = 'hnsw'
      WHERE i.indrelid = to_regclass($1) AND i.indisvalid AND am.amname = 'hnsw' AND op.opcname = 'vector_cosine_ops'
      AND i.indkey[0] = h.attnum AND format_type(d.atttypid,d.atttypmod) = $2 AND format_type(h.atttypid,h.atttypmod) = $3
    `, [table, `vector(${dimensions})`, `vector(${indexDimensions})`]);
    if (!rowCount) throw new Error('Embedding table needs index repair');
    if (current?.profile === profile && current.choice.modelId === choice.modelId && !current.blocked) return;
    await client.query(`UPDATE embedding_control SET profile = $1, model_choice = $2, generation = gen_random_uuid(),
      scan_cursor = 0, scan_done = false, dirty_cursor = 0, blocked_error = NULL, retry_not_before = NULL WHERE singleton`,
    [profile, JSON.stringify(choice)]);
  }

  async prepareCacheBooks(): Promise<void> {
    while (await this.transaction(async (client) => {
      const { rows: [state] } = await client.query<{ cursor: string[] | null; done: boolean }>(`
        SELECT cursor, done FROM embedding_discovery WHERE scope = 'ocr-cache-books' FOR UPDATE`);
      if (state.done) return false;
      const { rows } = await client.query<{ folder: string; filename: string }>(`
        WITH page AS MATERIALIZED (SELECT folder, filename FROM books ${state.cursor ? 'WHERE (folder, filename) > ($1, $2)' : ''}
          ORDER BY folder, filename LIMIT ${PAGE} FOR KEY SHARE),
        inserted AS (INSERT INTO embedding_ocr_books
          SELECT pdfit_ocr_cache_book_key(folder, filename), folder, filename FROM page ON CONFLICT DO NOTHING)
        SELECT folder, filename FROM page ORDER BY folder, filename`, state.cursor ?? []);
      const last = rows.at(-1);
      await client.query(`UPDATE embedding_discovery SET cursor = $1, done = $2 WHERE scope = 'ocr-cache-books'`,
        [last ? JSON.stringify([last.folder, last.filename]) : null, rows.length < PAGE]);
      return rows.length === PAGE;
    })) await new Promise<void>((resolve) => setImmediate(resolve));
  }

  async findCacheBook(hash: string): Promise<{ folder: string; filename: string } | undefined> {
    const { rows: [row] } = await this.db.query<{ folder: string; filename: string }>(`
      SELECT folder, filename FROM embedding_ocr_books WHERE hash = $1`, [hash]);
    return row;
  }

  private async discover(client: PoolClient): Promise<boolean> {
    const { rows: [state] } = await client.query<{ scope: SemanticScope; cursor: string[] | null }>(`
      SELECT scope, cursor FROM embedding_discovery WHERE NOT done AND scope <> 'ocr-cache-books' ORDER BY scope LIMIT 1 FOR UPDATE
    `);
    if (!state) return false;
    const page = state.scope === 'page-ocr';
    const { rows } = page ? await client.query<{ refid: string; cursor: string[] }>(`
      SELECT jsonb_build_array(folder, filename, page_index)::text AS refid,
        jsonb_build_array(folder, filename, page_index::text) AS cursor
      FROM book_page_ocr_search ${state.cursor ? 'WHERE (folder, filename, page_index) > ($1, $2, $3::int)' : ''}
      ORDER BY folder, filename, page_index LIMIT ${PAGE}
    `, state.cursor ?? []) : await client.query<{ refid: string; cursor: string[] }>(`
      SELECT id::text AS refid, jsonb_build_array(id::text) AS cursor FROM ${REF_TABLES[state.scope]}
      ${state.cursor ? 'WHERE id > $1::uuid' : ''} ORDER BY id LIMIT ${PAGE}
    `, state.cursor ?? []);
    if (rows.length) await client.query(`INSERT INTO embedding_sources(scope, refid)
      SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`, [state.scope, rows.map(({ refid }) => refid)]);
    await client.query('UPDATE embedding_discovery SET cursor = $2, done = $3 WHERE scope = $1',
      [state.scope, JSON.stringify(rows.at(-1)?.cursor ?? state.cursor), rows.length < PAGE]);
    return true;
  }

  async hasPending(active: ActiveIndex): Promise<boolean> {
    const { rows: [row] } = await this.db.query<{ pending: boolean }>(`
      SELECT EXISTS (SELECT 1 FROM embedding_work WHERE profile = $1 AND NOT ready AND NOT failed) AS pending`, [active.profile]);
    return row.pending;
  }

  async refill(active: ActiveIndex, admitNew = true): Promise<boolean> {
    return this.transaction(async (client) => {
      const { rows: [control] } = await client.query<{ scan_cursor: string; scan_done: boolean; dirty_cursor: string }>(`
        SELECT scan_cursor, scan_done, dirty_cursor FROM embedding_control WHERE singleton AND generation = $1 FOR UPDATE`, [active.generation]);
      if (!control) return false;
      // A stale pending job already owns a queue slot. Refresh it even when admission is closed.
      const refreshed = await client.query(`
        WITH stale AS MATERIALIZED (
          SELECT s.id, s.revision FROM embedding_work w JOIN embedding_sources s ON s.id = w.source
          WHERE w.profile = $1 AND NOT w.ready AND NOT w.failed AND w.revision <> s.revision
          ORDER BY w.due, w.source LIMIT ${PAGE} FOR UPDATE OF s
        ), replaced AS (
          UPDATE embedding_work w SET revision = stale.revision, position = 0, partial = false,
            attempts = 0, due = now(), lease = NULL, expires = NULL, error = NULL
          FROM stale WHERE w.profile = $1 AND w.source = stale.id RETURNING w.source, w.revision
        ) UPDATE embedding_sources s SET dirty = false FROM replaced r WHERE s.id = r.source AND s.revision = r.revision`,
      [active.profile]);
      if (!admitNew) return Boolean(refreshed.rowCount);
      const { rows: [{ count }] } = await client.query<{ count: number }>(`
        SELECT count(*)::int FROM (SELECT 1 FROM embedding_work WHERE profile = $1 AND NOT ready AND NOT failed LIMIT ${MAX_PENDING}) q`, [active.profile]);
      if (count > MAX_PENDING - 2 * PAGE) return Boolean(refreshed.rowCount);
      const discovering = await this.discover(client);
      const { rows: dirty } = await client.query<{ id: string; revision: string }>(`
        SELECT id, revision FROM embedding_sources WHERE dirty AND id > $1 ORDER BY id LIMIT ${PAGE} FOR UPDATE`, [control.dirty_cursor]);
      const { rows: scan } = control.scan_done ? { rows: [] } : await client.query<{ id: string; revision: string }>(`
        SELECT id, revision FROM embedding_sources WHERE id > $1 ORDER BY id LIMIT ${PAGE} FOR UPDATE`, [control.scan_cursor]);
      const next = [...new Map([...dirty, ...scan].map((row) => [row.id, row])).values()];
      if (next.length) await client.query(`
        INSERT INTO embedding_work(profile, source, revision)
        SELECT $1, id, revision FROM unnest($2::bigint[], $3::uuid[]) AS jobs(id, revision)
        ON CONFLICT (profile, source) DO UPDATE SET revision = excluded.revision, position = 0, ready = false, partial = false,
          failed = false, attempts = 0, due = now(), lease = NULL, expires = NULL, error = NULL
        WHERE embedding_work.revision <> excluded.revision OR embedding_work.failed`, [active.profile, next.map((row) => row.id), next.map((row) => row.revision)]);
      if (dirty.length) await client.query(`UPDATE embedding_sources s SET dirty = false
        FROM unnest($1::bigint[], $2::uuid[]) AS observed(id, revision)
        WHERE s.id = observed.id AND s.revision = observed.revision`, [dirty.map((row) => row.id), dirty.map((row) => row.revision)]);
      const dirtyCursor = dirty.length === PAGE ? dirty[PAGE - 1].id : '0';
      if (!control.scan_done || dirtyCursor !== control.dirty_cursor) {
        await client.query(`UPDATE embedding_control SET scan_cursor = $1, scan_done = $2, dirty_cursor = $3 WHERE singleton`,
          [scan.at(-1)?.id ?? control.scan_cursor, control.scan_done || scan.length < PAGE, dirtyCursor]);
      }
      // A wrap may have more dirty rows before the old cursor, even if this slice was empty.
      return Boolean(refreshed.rowCount) || discovering || next.length > 0 || control.dirty_cursor !== dirtyCursor;
    });
  }

  async reserve(active: ActiveIndex, width: number): Promise<ReservedWork> {
    const lease = randomUUID();
    const { rows: jobs } = await this.transaction((client) => client.query<Work>(`
      WITH picked AS MATERIALIZED (
        SELECT w.source FROM embedding_work w JOIN embedding_sources s ON s.id = w.source AND s.revision = w.revision
        WHERE w.profile = $1 AND NOT w.ready AND NOT w.failed AND w.due <= now()
        AND (w.lease IS NULL OR w.expires <= now()) ORDER BY w.due, w.source LIMIT $2 FOR UPDATE OF w SKIP LOCKED
      ), claimed AS (
        UPDATE embedding_work w SET lease = $3, expires = now() + interval '2 minutes'
        FROM picked WHERE w.profile = $1 AND w.source = picked.source RETURNING w.*
      ), numbered AS (SELECT *, row_number() OVER (ORDER BY due, source) AS ordinal FROM claimed)
      SELECT w.source, w.revision, w.position, w.attempts, s.scope, s.refid, COALESCE(src.partial, false) AS partial,
        COALESCE(substring(src.body FROM w.position + 1 FOR (CASE WHEN w.ordinal = 1 THEN $4::int ELSE $5::int END)), '') AS text
      FROM numbered w JOIN embedding_sources s ON s.id = w.source
      LEFT JOIN LATERAL (${lookupSource}) src ON true ORDER BY w.ordinal
    `, [active.profile, width, lease, width * SOURCE_WINDOW, SOURCE_WINDOW]));
    return { lease, jobs };
  }

  async publish(active: ActiveIndex, reservation: ReservedWork, items: EmbeddedChunk[], indexDimensions: number): Promise<void> {
    await this.transaction(async (client) => {
      const generation = await client.query('SELECT 1 FROM embedding_control WHERE singleton AND generation = $1 FOR SHARE', [active.generation]);
      if (!generation.rowCount) return;
      const table = quoteTable(active.table);
      for (const job of [...reservation.jobs].sort((a, b) => a.source.length - b.source.length || a.source.localeCompare(b.source))) {
        const current = await client.query('SELECT 1 FROM embedding_sources WHERE id = $1 AND revision = $2 FOR SHARE', [job.source, job.revision]);
        if (!current.rowCount) continue;
        const claimed = await client.query('SELECT 1 FROM embedding_work WHERE profile = $1 AND source = $2 AND lease = $3 AND expires > now() FOR UPDATE',
          [active.profile, job.source, reservation.lease]);
        if (!claimed.rowCount) continue;
        const chunks = items.filter((item) => item.job === job);
        for (const { chunk, vector } of chunks) {
          if (!vector) continue;
          const { rowCount, rows: [row] } = await client.query<{ id: string }>(`INSERT INTO embedding_chunks
            VALUES ($1,$2,$3,gen_random_uuid(),$4,$5) ON CONFLICT DO NOTHING RETURNING id`,
            [active.profile, job.source, job.revision, chunk.start, chunk.end]);
          if (rowCount) await client.query(`INSERT INTO ${table} VALUES ($1,$2,$3,$4,$5::vector,$6::vector)`,
            [row.id, chunk.contents, REF_TABLES[job.scope], job.refid, JSON.stringify(vector), JSON.stringify(vector.slice(0, indexDimensions))]);
        }
        const last = chunks.at(-1)?.chunk;
        await client.query(`UPDATE embedding_work SET lease = NULL, expires = NULL, position = $3, ready = $4, partial = $5,
          attempts = 0, error = NULL, due = now() WHERE profile = $1 AND source = $2`,
          [active.profile, job.source, last?.next ?? job.position, last?.finished ?? false, job.partial]);
      }
    });
  }

  async renewCurrent(active: ActiveIndex, reservation: ReservedWork): Promise<Set<string>> {
    const { rows } = await this.db.query<{ source: string }>(`
      UPDATE embedding_work w SET expires = now() + interval '2 minutes' FROM embedding_sources s, embedding_control c
      WHERE w.profile = $1 AND w.lease = $2 AND s.id = w.source AND s.revision = w.revision
      AND c.singleton AND c.generation = $3 AND c.blocked_error IS NULL AND coalesce(c.retry_not_before <= now(), true)
      RETURNING w.source`, [active.profile, reservation.lease, active.generation]);
    return new Set(rows.map(({ source }) => source));
  }

  async pause(active: ActiveIndex, retryAt: number | undefined): Promise<void> {
    const now = Date.now();
    const until = new Date(Math.min(now + 86_400_000, Math.max(now + 30_000, Number.isFinite(retryAt) ? retryAt! : now)));
    await this.db.query(`UPDATE embedding_control SET retry_not_before = greatest(retry_not_before, $2::timestamptz)
      WHERE singleton AND generation = $1`, [active.generation, until]);
  }

  async release(active: ActiveIndex, reservation: ReservedWork): Promise<void> {
    await this.db.query('UPDATE embedding_work SET lease = NULL, expires = NULL WHERE profile = $1 AND lease = $2',
      [active.profile, reservation.lease]);
  }

  async block(active: ActiveIndex, error: string): Promise<void> {
    await this.db.query('UPDATE embedding_control SET blocked_error = $2 WHERE singleton AND generation = $1', [active.generation, error]);
  }

  async retry(active: ActiveIndex, reservation: ReservedWork, error: string, retryAt?: number, permanent = false, sources?: string[]): Promise<void> {
    await this.db.query(`UPDATE embedding_work SET lease = NULL, expires = NULL, attempts = attempts+1, error = $3,
      due = greatest(now() + least(3600, 30 * power(2, least(attempts, 7))) * interval '1 second', $4::timestamptz), failed = $5 OR attempts >= 7
      WHERE profile = $1 AND lease = $2 AND ($6::bigint[] IS NULL OR source = ANY($6::bigint[]))`,
    [active.profile, reservation.lease, error, new Date(Math.min(Number.isFinite(retryAt) ? retryAt! : Date.now(), Date.now() + 86_400_000)),
      permanent, sources ?? null]);
  }

  async cleanup(): Promise<boolean> {
    return this.transaction(async (client) => {
      const { rows: [source] } = await client.query<{ id: string; revision: string }>(`
        SELECT id, revision FROM embedding_sources WHERE NOT clean ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`);
      if (!source) return false;
      const { rows } = await client.query<{ table_name: string; ids: string[] }>(`
        SELECT p.table_name, array_agg(c.id) AS ids FROM (
          SELECT profile, id FROM embedding_chunks WHERE source = $1 AND revision <> $2 LIMIT ${PAGE}
        ) c JOIN embedding_profiles p USING (profile) GROUP BY p.table_name`, [source.id, source.revision]);
      for (const { table_name, ids } of rows) {
        await client.query(`DELETE FROM ${quoteTable(table_name)} WHERE id = ANY($1::uuid[])`, [ids]);
        await client.query('DELETE FROM embedding_chunks WHERE id = ANY($1::uuid[])', [ids]);
      }
      if (rows.reduce((n, row) => n + row.ids.length, 0) < PAGE) await client.query('UPDATE embedding_sources SET clean = true WHERE id = $1', [source.id]);
      return true;
    });
  }

  async status(active: ActiveIndex | null) {
    if (!active) return { state: 'unconfigured' as const, pending: 0, failed: 0, partial: 0 };
    const { rows: [row] } = await this.db.query<{ indexing: boolean; pending: number; failed: number; partial: number; recentError: string | null }>(`
      SELECT EXISTS (SELECT 1 FROM embedding_discovery WHERE NOT done AND scope <> 'ocr-cache-books') OR EXISTS (SELECT 1 FROM embedding_sources WHERE dirty)
          OR NOT scan_done AS indexing,
        (SELECT count(*)::int FROM (SELECT 1 FROM embedding_work WHERE profile = $1 AND NOT ready AND NOT failed LIMIT ${MAX_PENDING}) q) AS pending,
        (SELECT count(*)::int FROM (SELECT 1 FROM embedding_work WHERE profile = $1 AND failed LIMIT ${MAX_PENDING}) q) AS failed,
        (SELECT count(*)::int FROM (SELECT 1 FROM embedding_work WHERE profile = $1 AND ready AND partial LIMIT ${MAX_PENDING}) q) AS partial,
        (SELECT error FROM embedding_work WHERE profile = $1 AND failed ORDER BY source LIMIT 1) AS "recentError"
      FROM embedding_control WHERE singleton`, [active.profile]);
    return { ...row, recentError: active.blocked ?? row.recentError, retryAt: active.retryAt?.toISOString() ?? null,
      state: active.blocked ? 'unavailable' as const : row.indexing || row.pending ? 'indexing' as const : row.failed ? 'unavailable' as const : 'ready' as const };
  }

  async search(active: ActiveIndex, query: number[], dimensions: number, limit: number, scope?: SemanticScope): Promise<SemanticHit[]> {
    const table = quoteTable(active.table);
    return this.transaction(async (client) => {
      await client.query(`SET LOCAL hnsw.ef_search = 200${this.iterativeScan ? '; SET LOCAL hnsw.iterative_scan = strict_order; SET LOCAL hnsw.max_scan_tuples = 3000' : ''}`);
      const current = `FROM embedding_chunks m JOIN embedding_sources s ON s.id = m.source AND s.revision = m.revision
        JOIN embedding_work w ON w.profile = m.profile AND w.source = m.source AND w.revision = m.revision AND w.ready`;
      const run = (candidates: string, cap: number) => client.query<SemanticHit>(`
        WITH candidates AS MATERIALIZED (${candidates}), ranked AS (
          SELECT s.refid AS id, s.scope, src.folder, src.filename, src.page, t.contents AS snippet,
            t.embedding <=> $3::vector AS distance,
            row_number() OVER (PARTITION BY s.id ORDER BY t.embedding <=> $3::vector, t.id) AS occurrence
          FROM candidates t JOIN embedding_chunks m ON m.profile = $4 AND m.id = t.id
          JOIN embedding_sources s ON s.id = m.source AND s.revision = m.revision
          JOIN embedding_work w ON w.profile = m.profile AND w.source = m.source AND w.revision = m.revision AND w.ready
          JOIN LATERAL (${lookupSource}) src ON true
          WHERE ($5::text IS NULL OR s.scope = $5) AND EXISTS (SELECT 1 FROM embedding_control WHERE singleton AND generation = $6)
        ) SELECT id, scope, folder, filename, page, snippet FROM ranked WHERE occurrence = 1 ORDER BY distance, scope, id LIMIT $7
      `, [JSON.stringify(query.slice(0, dimensions)), cap, JSON.stringify(query), active.profile, scope ?? null, active.generation, limit]);
      // Keep the scope and revision filter inside the ordered scan so pgvector can keep scanning past filtered rows.
      const approximate = await run(`SELECT hit.id, hit.contents, hit.embedding FROM ${table} hit
        WHERE (SELECT true ${current} WHERE m.profile = $4 AND m.id = hit.id AND ($5::text IS NULL OR s.scope = $5) LIMIT 1)
        ORDER BY hit.hnsw <=> $1::vector LIMIT $2`, Math.min(1000, limit * 12));
      if (approximate.rows.length >= limit || !scope) return approximate.rows;
      const exact = await run(`WITH small_scope AS MATERIALIZED (
          SELECT m.id ${current} WHERE m.profile = $4 AND s.scope = $5 AND $1::vector IS NOT NULL LIMIT $2 + 1
        ) SELECT hit.id, hit.contents, hit.embedding FROM small_scope JOIN ${table} hit USING (id)
        WHERE (SELECT count(*) FROM small_scope) <= $2`, 400);
      return exact.rows.length >= approximate.rows.length ? exact.rows : approximate.rows;
    });
  }

  async searchBook(active: ActiveIndex, query: number[], limit: number, book: { folder: string; filename: string }): Promise<SemanticHit[]> {
    const table = quoteTable(active.table);
    return this.transaction(async (client) => {
      // Build the candidate set from the book's source keys before comparing vectors.
      // A library-wide HNSW shortlist could miss every relevant chunk in this book.
      const { rows } = await client.query<SemanticHit>(`
        WITH book_refs AS MATERIALIZED (
          SELECT 'page-ocr' AS scope, jsonb_build_array(folder, filename, page_index)::text AS refid
          FROM book_page_ocr_search WHERE (folder, filename) = ($1, $2)
          UNION ALL
          SELECT kind.scope, p.id::text FROM bookmarks p
          CROSS JOIN (VALUES ('clip-ocr'), ('clip-memo')) kind(scope)
          WHERE (p.folder, p.filename) = ($1, $2)
          UNION ALL
          SELECT 'book-comment', id::text FROM book_comments WHERE (folder, filename) = ($1, $2)
        ), ranked AS (
          SELECT s.refid AS id, s.scope, src.folder, src.filename, src.page, hit.contents AS snippet,
            hit.embedding <=> $3::vector AS distance,
            row_number() OVER (PARTITION BY s.id ORDER BY hit.embedding <=> $3::vector, hit.id) AS occurrence
          FROM book_refs r JOIN embedding_sources s USING (scope, refid)
          JOIN embedding_work w ON w.profile = $4 AND w.source = s.id AND w.revision = s.revision AND w.ready
          JOIN embedding_chunks m ON m.profile = w.profile AND m.source = w.source AND m.revision = w.revision
          JOIN ${table} hit ON hit.id = m.id
          JOIN LATERAL (${lookupSource}) src ON true
          WHERE (src.folder, src.filename) = ($1, $2)
            AND EXISTS (SELECT 1 FROM embedding_control WHERE singleton AND generation = $5)
        ) SELECT id, scope, folder, filename, page, snippet
        FROM ranked WHERE occurrence = 1 ORDER BY distance, scope, id LIMIT $6
      `, [book.folder, book.filename, JSON.stringify(query), active.profile, active.generation, limit]);
      return rows;
    });
  }
}
