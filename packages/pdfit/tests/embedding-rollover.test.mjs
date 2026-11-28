import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import pg from 'pg';
import { EmbeddingStore } from '../dist/server/embedding/store.js';
import { EmbeddingService } from '../dist/server/embedding/service.js';
import { EmbeddingUpstreamError } from '../dist/server/embedding/client.js';
import { PostgresMetadataStore } from '../dist/server/postgres/index.js';
import { TaskScheduler } from '../dist/server/tasks/taskScheduler.js';

const database = process.env.PDFIT_TEST_DATABASE_URL;
const choice = { serverId: 1, modelId: 'rollover-fixture' };
const model = { name: 'rollover-fixture', dimensions: 4, indexDimensions: 2, embeddingConcurrency: 1,
  maxInputTokens: 512, matryoshka: true, revision: '', documentPrefix: '', queryPrefix: '' };

async function fixture(callback) {
  const schema = `embedding_rollover_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: database });
  const db = new pg.Pool({ connectionString: database, options: `-c search_path=${schema},public` });
  try {
    await admin.query(`CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE SCHEMA ${schema}`);
    await new PostgresMetadataStore(db, '.').ensureSchema();
    const store = new EmbeddingStore(db);
    await store.ensureSchema();
    await db.query(`INSERT INTO books(folder,filename,size,modified_at) VALUES ('fixture','source.pdf',42,'2026-11-28T00:00:00Z')`);
    await callback(db, store);
  } finally {
    await db.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
}

function insertComment(db, body) {
  return db.query(`INSERT INTO book_comments(id,folder,filename,body)
    VALUES (gen_random_uuid(),'fixture','source.pdf',$1) RETURNING id`, [body]).then(({ rows }) => rows[0].id);
}

async function until(check, description) {
  for (let tries = 0; tries < 500; tries++) {
    const result = await check();
    if (result) return result;
    await delay(20);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

test('a tick during an empty database check requests exactly one later check', async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let checks = 0;
  const store = {
    active: async () => ({ choice, blocked: null, retryAt: null }),
    cleanup: async () => false,
    refill: async () => false,
    reserve: async () => { if (++checks === 1) await held; return { jobs: [] }; },
    status: async () => ({}),
  };
  const scheduler = new TaskScheduler({ intervalMs: 60_000, concurrency: 1 });
  const service = new EmbeddingService(store, async () => ({ model }));
  service.register(scheduler);
  try {
    await scheduler.planNow();
    await until(() => checks === 1, 'first database check');
    await scheduler.planNow();
    await scheduler.planNow();
    assert.equal(checks, 1);
    release();
    await until(async () => checks === 2 && !(await service.status()).working, 'one follow-up check');
    assert.equal((await service.status()).rescanRequested, false);
  } finally {
    release();
    await scheduler.stop();
  }
});

test('a full queue replaces stale work in place and leaves new change markers available', { skip: !database }, async () => {
  await fixture(async (db, store) => {
    await store.transaction((client) => store.activate(client, choice, { baseUrl: 'http://127.0.0.1/v1', headers: {}, model }));
    const active = await store.active();
    await db.query(`INSERT INTO book_comments(id,folder,filename,body)
      SELECT gen_random_uuid(),'fixture','source.pdf','old' FROM generate_series(1,2000)`);
    await db.query('INSERT INTO embedding_work(profile,source,revision) SELECT $1,id,revision FROM embedding_sources', [active.profile]);
    const oldReservation = await store.reserve(active, 1);
    assert.equal(oldReservation.jobs[0].text, 'old');
    await db.query("UPDATE book_comments SET body = 'latest'");
    const newId = await insertComment(db, 'new while full');
    assert.equal((await store.renewCurrent(active, oldReservation)).size, 0);
    await store.release(active, oldReservation);
    await store.refill(active);
    assert.equal((await store.status(active)).pending, 2000);
    const next = await store.reserve(active, 1);
    assert.equal(next.jobs[0].text, 'latest');
    const { rows: [newSource] } = await db.query(`SELECT id, dirty FROM embedding_sources WHERE refid = $1`, [newId]);
    assert.equal(newSource.dirty, true);
    assert.equal((await db.query('SELECT 1 FROM embedding_work WHERE source = $1', [newSource.id])).rowCount, 0);
    await store.release(active, next);

    // Simulate acknowledgements freeing capacity. Discarding reservations and cursors in memory must not affect admission.
    await db.query('UPDATE embedding_work SET ready = true WHERE source IN (SELECT source FROM embedding_work ORDER BY source LIMIT 300)');
    const resumed = new EmbeddingStore(db);
    await until(async () => {
      await resumed.refill(active);
      const found = await db.query('SELECT 1 FROM embedding_work WHERE source = $1', [newSource.id]);
      if (found.rowCount) return true;
      // Simulate another bounded drain before the next reconciliation.
      await db.query('UPDATE embedding_work SET ready = true WHERE source IN (SELECT source FROM embedding_work WHERE NOT ready ORDER BY source LIMIT 200)');
    }, 'new work admitted as space opens');
  });
});

test('repeated edits of earlier IDs do not starve later change markers', { skip: !database }, async () => {
  await fixture(async (db, store) => {
    await store.transaction((client) => store.activate(client, choice, { baseUrl: 'http://127.0.0.1/v1', headers: {}, model }));
    const active = await store.active();
    await db.query(`UPDATE embedding_control SET scan_done = true; UPDATE embedding_discovery SET done = true;
      INSERT INTO book_comments(id,folder,filename,body)
      SELECT gen_random_uuid(),'fixture','source.pdf','initial' FROM generate_series(1,150)`);
    await store.refill(active);
    assert.equal((await store.status(active)).pending, 100);
    await db.query(`UPDATE embedding_work SET ready = true;
      UPDATE book_comments c SET body = 'edited again' FROM embedding_sources s WHERE s.id <= 100 AND c.id::text = s.refid`);
    await store.refill(active);
    const { rows: [later] } = await db.query('SELECT count(*)::int AS count FROM embedding_work WHERE source > 100');
    assert.equal(later.count, 50);
    const { rows: [earlier] } = await db.query('SELECT count(*)::int AS count FROM embedding_sources WHERE id <= 100 AND dirty');
    assert.equal(earlier.count, 100);
    await store.refill(active);
    assert.equal((await store.status(active)).pending, 150);
  });
});

test('overlapping ticks coalesce while a request is held and publish only the latest source revision', { skip: !database }, async () => {
  await fixture(async (db, store) => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const requests = [];
    let concurrent = 0;
    let peak = 0;
    const provider = createServer(async (req, res) => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      const buffers = [];
      for await (const part of req) buffers.push(part);
      const { input } = JSON.parse(Buffer.concat(buffers));
      requests.push(input);
      if (input.includes('old document')) await held;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: input.map((_, index) => ({ index, embedding: [1, 2, 3, 4] })) }));
      concurrent -= 1;
    });
    provider.listen(0, '127.0.0.1');
    await once(provider, 'listening');
    const endpoint = { baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, headers: {}, model };
    const scheduler = new TaskScheduler({ intervalMs: 200, initialDelayMs: 0, concurrency: 1 });
    const service = new EmbeddingService(store, async () => endpoint);
    service.register(scheduler);
    try {
      await store.transaction((client) => store.activate(client, choice, endpoint));
      const oldId = await insertComment(db, 'old document');
      scheduler.start();
      await until(() => requests.length === 1, 'first embedding HTTP request');
      const firstPlan = scheduler.status().planCount;
      await db.query('UPDATE book_comments SET body = $2 WHERE id = $1', [oldId, 'intermediate edit']);
      await db.query('UPDATE book_comments SET body = $2 WHERE id = $1', [oldId, 'final edit']);
      await insertComment(db, 'another document');
      await until(() => scheduler.status().planCount >= firstPlan + 3, 'three scheduler ticks during the same request');
      assert.deepEqual(requests, [['old document']]);
      assert.equal((await service.status()).rescanRequested, true);
      release();
      await until(async () => (await service.status()).state === 'ready', 'all latest revisions published');
      assert.equal(peak, 1);
      assert.deepEqual(requests.flat().sort(), ['another document', 'final edit', 'old document']);
      const active = await store.active();
      const { rows } = await db.query(`SELECT contents FROM "${active.table}" ORDER BY contents`);
      assert.deepEqual(rows.map((row) => row.contents), ['another document', 'final edit']);
      const hits = await store.search(active, [1, 2, 3, 4], 2, 10, 'book-comment');
      assert.deepEqual(hits.map((hit) => hit.snippet).sort(), ['another document', 'final edit']);
    } finally {
      release();
      await scheduler.stop();
      await until(async () => !(await service.status()).working, 'in-flight reservation released');
      provider.closeAllConnections();
      await new Promise((resolve) => provider.close(resolve));
    }
  });
});

test('a provider retry deadline survives a scheduler replacement and subsequent ticks', { skip: !database }, async () => {
  await fixture(async (db, store) => {
    const endpoint = { baseUrl: 'http://127.0.0.1/v1', headers: {}, model };
    let calls = 0;
    const client = { embed: async () => {
      if (++calls === 1) throw new EmbeddingUpstreamError(429, Date.now() + 120_000);
      return [[1, 2, 3, 4]];
    } };
    const firstScheduler = new TaskScheduler({ intervalMs: 60_000, concurrency: 1 });
    const secondScheduler = new TaskScheduler({ intervalMs: 60_000, concurrency: 1 });
    const firstService = new EmbeddingService(store, async () => endpoint, client);
    const secondService = new EmbeddingService(new EmbeddingStore(db), async () => endpoint, client);
    firstService.register(firstScheduler);
    secondService.register(secondScheduler);
    try {
      await store.transaction((connection) => store.activate(connection, choice, endpoint));
      await insertComment(db, 'first queued');
      await insertComment(db, 'second queued');
      await firstScheduler.planNow();
      await until(async () => {
        const status = await firstService.status();
        return status.retryAt && !status.working;
      }, 'provider retry deadline saved');
      await firstScheduler.stop();
      for (let tick = 0; tick < 3; tick++) {
        await secondScheduler.planNow();
        await until(async () => !(await secondService.status()).working, 'paused scheduler check');
      }
      assert.equal(calls, 1);
      assert.equal((await secondService.status()).pending, 2);
      await db.query('UPDATE embedding_control SET retry_not_before = now(); UPDATE embedding_work SET due = now()');
      await secondScheduler.planNow();
      await until(async () => (await secondService.status()).state === 'ready', 'retry and remaining work completed');
      assert.equal(calls, 3);
    } finally {
      await firstScheduler.stop();
      await secondScheduler.stop();
    }
  });
});
