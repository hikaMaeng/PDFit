// 빌드 산출물 기준: `npm run build --workspace=@pdfit/pdfit` 후 `node --test tests/favorites.test.mjs`.
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import test from 'node:test';
import express from 'express';
import pg from 'pg';
import { createFavoritesRouter } from '../dist/server/routes/favorites.js';
import { PostgresMetadataStore } from '../dist/server/postgres/index.js';

async function withServer(store, bus, run) {
  const app = express();
  app.use('/api/favorites', createFavoritesRouter(store, bus));
  const server = app.listen(0); await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}/api/favorites`); }
  finally { server.close(); await once(server, 'close'); }
}

test('favorites routes read and write the store and announce a change', async () => {
  const calls = [];
  const store = {
    listFavoriteKeys: async () => [{ folder: 'A', filename: 'x.pdf' }],
    listFavoriteBooks: async () => [{ folder: 'A', filename: 'x.pdf', size: 1, modified_at: '', tags: ['t'] }],
    setFavorite: async (folder, filename, favorite) => { calls.push([folder, filename, favorite]); return favorite; },
  };
  const bus = new EventEmitter();
  const events = [];
  bus.on('change', (event) => events.push(event));
  await withServer(store, bus, async (base) => {
    assert.deepEqual(await (await fetch(base)).json(), [{ folder: 'A', filename: 'x.pdf' }]);
    assert.equal((await (await fetch(`${base}/books`)).json())[0].tags[0], 't');
    // 한글·공백이 든 이름도 인코딩된 그대로 왕복한다.
    const name = encodeURIComponent('책 제목.pdf');
    assert.deepEqual(await (await fetch(`${base}/${encodeURIComponent('이북')}/${name}`, { method: 'PUT' })).json(), { ok: true, favorite: true });
    assert.deepEqual(await (await fetch(`${base}/${encodeURIComponent('이북')}/${name}`, { method: 'DELETE' })).json(), { ok: true, favorite: false });
  });
  assert.deepEqual(calls, [['이북', '책 제목.pdf', true], ['이북', '책 제목.pdf', false]]);
  assert.deepEqual(events, ['favorites-changed', 'favorites-changed']);
});

test('favorites routes report 501 for stores without favorites', async () => {
  await withServer({}, undefined, async (base) => {
    assert.equal((await fetch(base)).status, 501);
    assert.equal((await fetch(`${base}/books`)).status, 501);
    assert.equal((await fetch(`${base}/A/x.pdf`, { method: 'PUT' })).status, 501);
  });
});

// 실제 PostgreSQL: DB(`books`)만으로 동작하고, 파일 점검이 부르는 purge가 즐겨찾기를 지우는지 본다.
// 사용: PDFIT_TEST_DATABASE_URL=postgres://... node --test tests/favorites.test.mjs
test('PostgresMetadataStore favorites follow the books table and purges', { skip: !process.env.PDFIT_TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: process.env.PDFIT_TEST_DATABASE_URL });
  const schema = `favorites_${process.pid}`;
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO ${schema}`);
      const store = new PostgresMetadataStore({ query: (...args) => client.query(...args), connect: async () => client }, '.');
      await store.ensureSchema();
      await store.syncBooks([
        { folder: 'Dev', filename: 'a.pdf', size: 1, modified_at: 'a' },
        { folder: 'Dev', filename: 'b.pdf', size: 2, modified_at: 'b' },
        { folder: 'Etc', filename: 'c.pdf', size: 3, modified_at: 'c' },
      ]);
      const keys = async () => (await store.listFavoriteKeys()).map((row) => `${row.folder}/${row.filename}`).sort();

      assert.deepEqual(await keys(), []);
      assert.equal(await store.setFavorite('Dev', 'a.pdf', true), true);
      assert.equal(await store.setFavorite('Dev', 'a.pdf', true), true, '이미 켜진 책을 다시 켜도 그대로 켜져 있다');
      assert.equal(await store.setFavorite('Etc', 'c.pdf', true), true);
      assert.equal(await store.setFavorite('Dev', 'ghost.pdf', true), false, 'books에 없는 책은 켜지지 않는다');
      assert.deepEqual(await keys(), ['Dev/a.pdf', 'Etc/c.pdf']);

      await store.addTag('Dev', 'a.pdf', '자바');
      const books = await store.listFavoriteBooks();
      assert.deepEqual(books.map((book) => [book.folder, book.filename]).sort(), [['Dev', 'a.pdf'], ['Etc', 'c.pdf']]);
      assert.deepEqual(books.find((book) => book.filename === 'a.pdf').tags, ['자바']);

      // 목록 새로고침(syncBooks)은 비파괴적이라 즐겨찾기를 건드리지 않는다.
      await store.syncBooks([{ folder: 'Dev', filename: 'a.pdf', size: 9, modified_at: 'z' }]);
      assert.deepEqual(await keys(), ['Dev/a.pdf', 'Etc/c.pdf']);

      // DB 기준: books에서 사라진 책은 purge 전에도 목록에 나오지 않는다(파일 시스템은 보지 않는다).
      await client.query('DELETE FROM books WHERE folder = $1 AND filename = $2', ['Etc', 'c.pdf']);
      assert.deepEqual(await keys(), ['Dev/a.pdf']);
      // 파일 점검(감시기·삭제·이동)의 purge가 행 자체를 지운다.
      await store.purgeFile('Etc', 'c.pdf');
      assert.equal((await client.query('SELECT 1 FROM book_favorites WHERE folder = $1', ['Etc'])).rows.length, 0);

      await store.setFavorite('Dev', 'b.pdf', true);
      await store.purgeFile('Dev', 'a.pdf');
      assert.deepEqual(await keys(), ['Dev/b.pdf']);
      await store.purgeFolder('Dev');
      assert.deepEqual(await keys(), []);
      assert.equal((await client.query('SELECT 1 FROM book_favorites')).rows.length, 0);

      await store.syncBooks([{ folder: 'Dev', filename: 'a.pdf', size: 1, modified_at: 'a' }]);
      await store.setFavorite('Dev', 'a.pdf', true);
      assert.equal(await store.setFavorite('Dev', 'a.pdf', false), false);
      assert.deepEqual(await keys(), []);
    } finally { client.release(); }
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  }
});
