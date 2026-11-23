import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import pg from 'pg';
import { PostgresMetadataStore } from '../dist/server/postgres/index.js';
import { createTagsRouter } from '../dist/server/routes/tags.js';

async function withTagRoute(store, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/tags', createTagsRouter(store));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run((id, body) => fetch(`http://127.0.0.1:${server.address().port}/api/tags/${id}/details`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('tag detail route validates changes and distinguishes missing, stale, and duplicate tags', async () => {
  const calls = [];
  const store = { updateTagDetails: async (id, patch) => {
    calls.push({ id, patch });
    if (id === '1') return { status: 'missing' };
    if (id === '2') return { status: 'stale' };
    if (id === '3') return { status: 'duplicate' };
    return { status: 'updated', tag: { name: patch.name, color: patch.color, icon: patch.icon } };
  } };
  await withTagRoute(store, async (patch) => {
    const valid = { previousName: 'AI', name: '  개발 100% / 실습  ', color: '#A855F7', icon: 'code' };
    for (const body of [{}, { previousName: 'AI' }, ...['', '  ', '..', 'x'.repeat(201), 'a\u0000b', '\ud800'].map((name) => ({ ...valid, name })), { ...valid, color: 'blue' }, { ...valid, icon: 'remote.svg' }]) {
      assert.equal((await patch('4', body)).status, 400);
    }
    assert.equal((await patch('9223372036854775808', valid)).status, 400);
    assert.equal(calls.length, 0);
    for (const [id, status] of [['1', 404], ['2', 412], ['3', 409]]) assert.equal((await patch(id, valid)).status, status);
    const response = await patch('4', valid);
    const expected = { name: '개발 100% / 실습', color: '#a855f7', icon: 'code' };
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expected);
    assert.deepEqual(calls.at(-1), { id: '4', patch: { previousName: 'AI', ...expected } });
  });
  await withTagRoute({}, async (patch) => assert.equal((await patch('4', { previousName: 'AI', icon: 'book' })).status, 501));
});

test('PostgreSQL migrates legacy tags and preserves tag IDs, document links, and folder memberships', { skip: !process.env.PDFIT_TEST_DATABASE_URL }, async () => {
  const connectionString = process.env.PDFIT_TEST_DATABASE_URL;
  const schema = `tagediting_${process.pid}`;
  const fallback = `tagediting_fallback_${process.pid}`;
  const admin = new pg.Pool({ connectionString });
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema},${fallback}` });
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`CREATE SCHEMA ${fallback}`);
    await admin.query(`CREATE TABLE ${fallback}.bookmarks (keep TEXT); INSERT INTO ${fallback}.bookmarks VALUES ('preserved')`);
    await pool.query('CREATE TABLE tags (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL)');
    await pool.query("INSERT INTO tags (name, color) VALUES ('기존', '#22c55e')");
    const store = new PostgresMetadataStore(pool, '.');
    await store.ensureSchema();
    await store.ensureSchema();
    assert.deepEqual((await admin.query(`SELECT keep FROM ${fallback}.bookmarks`)).rows, [{ keep: 'preserved' }]);
    await store.syncBooks(['linked.pdf', 'other.pdf'].map((filename) => ({ folder: 'Dev', filename, size: 1, modified_at: 'today' })));
    await store.addTag('Dev', 'linked.pdf', '기존');
    await store.addTag('Dev', 'linked.pdf', '함께');
    for (const folder of ['개발', '나중']) {
      assert.equal(await store.createTagFolder(folder), true);
      assert.equal(await store.addTagToTagFolder(folder, '기존'), true);
    }
    const original = (await store.listTagSummaries()).find(({ name }) => name === '기존');
    assert.deepEqual(original, { id: '1', name: '기존', icon: 'tag', color: '#22c55e', bookCount: 1 });
    await withTagRoute(store, async (patch) => {
      const update = { previousName: original.name, name: '수정된 태그', icon: 'book', color: '#a855f7' };
      const collision = await patch(original.id, { ...update, name: '함께' });
      assert.equal(collision.status, 409);
      assert.deepEqual((await store.listTagSummaries()).find(({ id }) => id === original.id), original);
      assert.equal((await patch(original.id, update)).status, 200);
      assert.equal((await patch(original.id, { previousName: original.name, color: '#000000' })).status, 412);
      const renamed = (await store.listTagSummaries()).find(({ id }) => id === original.id);
      assert.deepEqual(renamed, { id: original.id, name: update.name, icon: update.icon, color: update.color, bookCount: 1 });
      assert.deepEqual(await store.listBookTags('Dev', 'linked.pdf'), [update.name, '함께']);
      assert.deepEqual((await store.listBooksByTag(update.name)).map(({ filename }) => filename), ['linked.pdf']);
      assert.deepEqual(await store.listBooksByTag(original.name), []);
      assert.deepEqual((await store.listTagIndex()).find(({ name }) => name === update.name), {
        name: update.name, color: update.color, icon: update.icon, books: [{ folder: 'Dev', filename: 'linked.pdf' }],
      });
      assert.deepEqual((await store.listTagFolders()).map(({ tags }) => tags), [[update.name], [update.name]]);
      assert.equal(await store.countUntaggedBooks(), 1);

      await store.updateTagColor(update.name, '#123456');
      const iconOnly = await patch(original.id, { previousName: update.name, icon: 'vector' });
      assert.deepEqual(await iconOnly.json(), { name: update.name, color: '#123456', icon: 'vector' });
      assert.equal((await store.listTagSummaries()).find(({ id }) => id === original.id).icon, 'vector');
      const other = (await store.listTagSummaries()).find(({ name }) => name === '함께');
      const race = await Promise.all([
        patch(renamed.id, { previousName: renamed.name, name: '동시 요청' }),
        patch(other.id, { previousName: other.name, name: '동시 요청' }),
      ]);
      assert.deepEqual(race.map(({ status }) => status).sort(), [200, 409]);
      const removed = (await store.listTagSummaries()).find(({ id }) => id === original.id);
      await store.deleteTag(removed.name);
      await store.addTag('Dev', 'linked.pdf', removed.name);
      assert.equal((await patch(original.id, { previousName: removed.name, icon: 'star' })).status, 404);
      assert.deepEqual((await store.listTagFolders()).map(({ tags }) => tags), [[], []]);
      assert.equal((await store.listTagSummaries()).find(({ name }) => name === removed.name).icon, 'tag');
    });
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.query(`DROP SCHEMA IF EXISTS ${fallback} CASCADE`);
    await admin.end();
  }
});
