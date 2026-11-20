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

const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('tag folder routes validate names, announce changes, and round-trip Korean names', async () => {
  const calls = [];
  const known = new Set();
  const store = {
    listTagFolders: async () => [{ name: '개발', tags: ['AI'] }],
    createTagFolder: async (name) => { calls.push(['create', name]); if (known.has(name)) return false; known.add(name); return true; },
    deleteTagFolder: async (name) => { calls.push(['delete', name]); return true; },
    addTagToTagFolder: async (folder, tag) => { calls.push(['add', folder, tag]); return folder !== '없음'; },
    removeTagFromTagFolder: async (folder, tag) => { calls.push(['remove', folder, tag]); return true; },
  };
  const bus = new EventEmitter();
  const events = [];
  bus.on('change', (event) => events.push(event));
  await withServer(store, bus, async (base) => {
    assert.deepEqual(await (await fetch(base)).json(), [{ name: '개발', tags: ['AI'] }]);
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
  });
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
