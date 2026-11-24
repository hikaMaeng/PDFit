// 빌드 산출물 기준: `npm run build --workspace=@pdfit/pdfit` 후 `node --test tests/tag-folders.test.mjs`.
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import test from 'node:test';
import express from 'express';
import pg from 'pg';
import { createTagFoldersRouter } from '../dist/server/routes/tagFolders.js';
import { PostgresMetadataStore } from '../dist/server/postgres/index.js';

async function withServer(store, bus, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/tag-folders', createTagFoldersRouter(store, bus));
  const server = app.listen(0); await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}/api/tag-folders`); }
  finally { server.close(); await once(server, 'close'); }
}

const json = (body, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('tag folder routes validate names, announce changes, and round-trip Korean names', async () => {
  const calls = [];
  const known = new Set();
  const folder = { id: 'a1000000-0000-4000-8000-000000000000', name: '개발', color: null, tags: ['AI'] };
  const store = {
    listTagFolders: async () => [folder],
    createTagFolder: async (name) => { calls.push(['create', name]); if (known.has(name)) return false; known.add(name); return true; },
    deleteTagFolder: async (name) => { calls.push(['delete', name]); return true; },
    addTagToTagFolder: async (folder, tag) => { calls.push(['add', folder, tag]); return folder !== '없음'; },
    removeTagFromTagFolder: async (folder, tag) => { calls.push(['remove', folder, tag]); return true; },
  };
  const bus = new EventEmitter();
  const events = [];
  bus.on('change', (event) => events.push(event));
  await withServer(store, bus, async (base) => {
    assert.deepEqual(await (await fetch(base)).json(), [folder]);
    assert.equal((await fetch(base, json({ name: '   ' }))).status, 400, '빈 이름은 거부한다');
    assert.equal((await fetch(base, json({ name: 'x'.repeat(101) }))).status, 400, '100자를 넘는 이름은 거부한다');
    assert.equal((await fetch(base, json({}))).status, 400);
    const created = await fetch(base, json({ name: '  기초 자료  ' }));
    assert.equal(created.status, 201);
    assert.equal((await created.json()).name, '기초 자료', '앞뒤 공백은 다듬어 저장한다');
    assert.equal((await fetch(base, json({ name: '기초 자료' }))).status, 409, '같은 이름은 거부한다');
    assert.equal((await fetch(`${base}/${encodeURIComponent('기초 자료')}/tags/${encodeURIComponent('C++')}`, { method: 'PUT' })).status, 200);
    assert.equal((await fetch(`${base}/${encodeURIComponent('없음')}/tags/AI`, { method: 'PUT' })).status, 404, '없는 폴더는 404');
    assert.equal((await fetch(`${base}/${encodeURIComponent('기초 자료')}/tags/${encodeURIComponent('C++')}`, { method: 'DELETE' })).status, 200);
    assert.equal((await fetch(`${base}/${encodeURIComponent('기초 자료')}`, { method: 'DELETE' })).status, 200);
  });
  assert.deepEqual(calls, [
    ['create', '기초 자료'], ['create', '기초 자료'],
    ['add', '기초 자료', 'C++'], ['add', '없음', 'AI'],
    ['remove', '기초 자료', 'C++'], ['delete', '기초 자료'],
  ]);
  // 성공한 변경만 알린다(409·404는 알리지 않는다).
  assert.deepEqual(events, ['tag-folders-changed', 'tag-folders-changed', 'tag-folders-changed', 'tag-folders-changed']);
});

test('tag folder routes report 501 for stores without tag folders', async () => {
  await withServer({}, undefined, async (base) => {
    assert.equal((await fetch(base)).status, 501);
    assert.equal((await fetch(base, json({ name: 'A' }))).status, 501);
    assert.equal((await fetch(`${base}/A`, { method: 'DELETE' })).status, 501);
    assert.equal((await fetch(`${base}/A/tags/x`, { method: 'PUT' })).status, 501);
    assert.equal((await fetch(`${base}/A/tags/x`, { method: 'DELETE' })).status, 501);
    assert.equal((await fetch(`${base}/A/details`, json({}, 'PATCH'))).status, 501);
    assert.equal((await fetch(`${base}/A/move`, json({}))).status, 501);
  });
});

test('tag folder edit and move validate requests and announce successful changes', async () => {
  const id = 'a1000000-0000-4000-8000-000000000000';
  const neighborId = 'b1000000-0000-4000-8000-000000000000';
  const calls = [];
  const events = [];
  const bus = new EventEmitter();
  bus.on('change', (event) => events.push(event));
  await withServer({
    editTagFolder: async (target, patch) => {
      calls.push([target, patch]);
      if (target !== id) return 'missing';
      return patch.name === '중복' ? 'duplicate' : 'updated';
    },
    moveTagFolder: async (target, move) => {
      calls.push([target, move]);
      if (target !== id) return 'missing';
      return move.direction === 'down' ? 'moved' : 'stale';
    },
  }, bus, async (base) => {
    const edit = (body, target = id) => fetch(`${base}/${target}/details`, json(body, 'PATCH'));
    const move = (body, target = id) => fetch(`${base}/${target}/move`, json(body));
    for (const body of [{}, { name: ' ' }, { name: 'x'.repeat(101) }, { name: '..' }, { color: 'red' }]) {
      assert.equal((await edit(body)).status, 400);
    }
    assert.equal((await edit({ name: '변경' }, 'invalid-id')).status, 400);
    assert.equal((await edit({ name: '중복' })).status, 409);
    assert.equal((await edit({ color: null }, neighborId)).status, 404);
    assert.equal((await edit({ name: '  가/자료 %  ', color: '#EF4444' })).status, 204);
    assert.equal((await move({ direction: 'left', neighborId })).status, 400);
    assert.equal((await move({ direction: 'up', neighborId: id })).status, 400);
    assert.equal((await move({ direction: 'up', neighborId: id }, neighborId)).status, 404);
    assert.equal((await move({ direction: 'up', neighborId })).status, 409);
    assert.equal((await move({ direction: 'down', neighborId })).status, 204);
  });
  assert.deepEqual(calls, [
    [id, { name: '중복' }],
    [neighborId, { color: null }],
    [id, { name: '가/자료 %', color: '#ef4444' }],
    [neighborId, { direction: 'up', neighborId: id }],
    [id, { direction: 'up', neighborId }],
    [id, { direction: 'down', neighborId }],
  ]);
  assert.deepEqual(events, ['tag-folders-changed', 'tag-folders-changed']);
});

// 실제 PostgreSQL: 한 태그가 여러 폴더에 속하고, 폴더 삭제는 태그를 남기며, 태그 삭제는 소속을 지운다.
// 사용: PDFIT_TEST_DATABASE_URL=postgres://... node --test tests/tag-folders.test.mjs
test('PostgresMetadataStore tag folders hold tags in many folders', { skip: !process.env.PDFIT_TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: process.env.PDFIT_TEST_DATABASE_URL });
  const schema = `tagfolders_${process.pid}`;
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO ${schema}`);
      const store = new PostgresMetadataStore({ query: (...args) => client.query(...args), connect: async () => client }, '.');
      await store.ensureSchema();
      await store.syncBooks([{ folder: 'Dev', filename: 'a.pdf', size: 1, modified_at: 'a' }]);
      await store.addTag('Dev', 'a.pdf', 'AI');
      await store.addTag('Dev', 'a.pdf', '자바');
      const view = async () => Object.fromEntries((await store.listTagFolders()).map((folder) => [folder.name, folder.tags]));

      assert.deepEqual(await view(), {});
      assert.equal(await store.createTagFolder('개발'), true);
      assert.equal(await store.createTagFolder('개발'), false, '같은 이름은 만들 수 없다');
      assert.equal(await store.createTagFolder('나중'), true);
      assert.deepEqual(await view(), { 개발: [], 나중: [] });

      assert.equal(await store.addTagToTagFolder('개발', 'AI'), true);
      assert.equal(await store.addTagToTagFolder('개발', 'AI'), true, '이미 들어 있어도 성공이다');
      assert.equal(await store.addTagToTagFolder('나중', 'AI'), true, '한 태그는 여러 폴더에 속할 수 있다');
      assert.equal(await store.addTagToTagFolder('개발', '자바'), true);
      assert.equal(await store.addTagToTagFolder('개발', '없는태그'), false, '없는 태그는 넣을 수 없다');
      assert.equal(await store.addTagToTagFolder('없는폴더', 'AI'), false, '없는 폴더에는 넣을 수 없다');
      assert.deepEqual(await view(), { 개발: ['AI', '자바'], 나중: ['AI'] });

      assert.equal(await store.removeTagFromTagFolder('개발', '자바'), true);
      assert.equal(await store.removeTagFromTagFolder('개발', '자바'), false);
      assert.deepEqual(await view(), { 개발: ['AI'], 나중: ['AI'] });

      // 폴더를 지우면 태그는 그대로 남고 그 폴더 소속만 사라진다.
      assert.equal(await store.deleteTagFolder('개발'), true);
      assert.equal(await store.deleteTagFolder('개발'), false);
      assert.deepEqual(await view(), { 나중: ['AI'] });
      assert.deepEqual((await store.listTagSummaries()).map((row) => row.name).sort(), ['AI', '자바']);

      // 태그를 지우면 모든 폴더에서 소속이 함께 사라진다.
      await store.deleteTag('AI');
      assert.deepEqual(await view(), { 나중: [] });
      assert.equal((await client.query('SELECT 1 FROM tag_folder_tags')).rows.length, 0);
    } finally { client.release(); }
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  }
});

test('PostgresMetadataStore migrates legacy folders and persists edits and serialized moves', { skip: !process.env.PDFIT_TEST_DATABASE_URL }, async () => {
  const schema = `tag_folder_edit_${process.pid}`;
  const connectionString = process.env.PDFIT_TEST_DATABASE_URL;
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}` });
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`
      CREATE TABLE tags (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL);
      CREATE TABLE tag_folders (name TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE TABLE tag_folder_tags (
        folder_name TEXT NOT NULL REFERENCES tag_folders(name) ON DELETE CASCADE,
        tag_id BIGINT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (folder_name, tag_id)
      );
      INSERT INTO tags (name, color) VALUES ('AI', '#22c55e');
      INSERT INTO tag_folders (name) VALUES ('나'), ('가'), ('다');
      INSERT INTO tag_folder_tags SELECT '나', id FROM tags WHERE name = 'AI';
    `);
    const store = new PostgresMetadataStore(pool, '.');
    await store.ensureSchema();
    const [first, second, third] = await store.listTagFolders();
    assert.deepEqual([first.name, second.name, third.name], ['가', '나', '다']);
    assert.equal(second.color, null);
    assert.deepEqual(second.tags, ['AI']);
    await store.ensureSchema();
    assert.deepEqual(await store.listTagFolders(), [first, second, third]);

    const duplicate = await store.editTagFolder(second.id, { name: first.name, color: '#ef4444' });
    assert.equal(duplicate, 'duplicate');
    assert.deepEqual(await store.listTagFolders(), [first, second, third]);
    assert.deepEqual(await Promise.all([
      store.moveTagFolder(second.id, { direction: 'up', neighborId: first.id }),
      store.moveTagFolder(second.id, { direction: 'up', neighborId: first.id }),
    ]), ['moved', 'stale']);
    assert.equal(await store.editTagFolder(second.id, { name: '마/자료 %', color: '#ef4444' }), 'updated');
    assert.equal(await store.createTagFolder('A'), true);
    const ordered = await new PostgresMetadataStore(pool, '.').listTagFolders();
    assert.deepEqual(ordered.slice(0, 3), [{ ...second, name: '마/자료 %', color: '#ef4444' }, first, third]);
    assert.equal(ordered[3].name, 'A');
    assert.equal(await store.moveTagFolder(second.id, { direction: 'down', neighborId: first.id }), 'moved');
    assert.equal(await store.editTagFolder(second.id, { color: null }), 'updated');
    assert.deepEqual(await store.listTagFolders(), [first, { ...second, name: '마/자료 %' }, third, ordered[3]]);
    assert.equal(await store.deleteTagFolder('마/자료 %'), true);
    assert.equal((await pool.query('SELECT 1 FROM tag_folder_tags')).rowCount, 0);
    assert.equal((await pool.query('SELECT 1 FROM tags WHERE name = $1', ['AI'])).rowCount, 1);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  }
});
