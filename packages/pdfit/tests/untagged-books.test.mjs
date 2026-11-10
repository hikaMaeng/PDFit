// 빌드 산출물 기준: `npm run build --workspace=@pdfit/pdfit` 후 `node --test tests/untagged-books.test.mjs`.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import pg from 'pg';
import { createTagsRouter } from '../dist/server/routes/tags.js';
import { PostgresMetadataStore } from '../dist/server/postgres/index.js';

async function withServer(store, run) {
  const app = express();
  app.use('/api/tags', createTagsRouter(store));
  const server = app.listen(0); await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}/api/tags`); }
  finally { server.close(); await once(server, 'close'); }
}

test('untagged routes return the store result and do not collide with the tag-name book route', async () => {
  const store = {
    listUntaggedBooks: async () => [{ folder: 'A', filename: 'x.pdf', size: 1, modified_at: '', tags: [] }],
    countUntaggedBooks: async () => 3,
    listBooksByTag: async (tag) => [{ folder: 'T', filename: `${tag}.pdf`, size: 2, modified_at: '', tags: [tag] }],
  };
  await withServer(store, async (base) => {
    assert.deepEqual(await (await fetch(`${base}/untagged-books`)).json(), [{ folder: 'A', filename: 'x.pdf', size: 1, modified_at: '', tags: [] }]);
    assert.deepEqual(await (await fetch(`${base}/untagged-count`)).json(), { count: 3 });
    // 이름이 "untagged-books"인 실제 태그는 여전히 `/:tag/books`로 조회된다.
    assert.equal((await (await fetch(`${base}/${encodeURIComponent('untagged-books')}/books`)).json())[0].filename, 'untagged-books.pdf');
  });
});

test('untagged routes report 501 for stores that cannot list untagged books', async () => {
  await withServer({}, async (base) => {
    assert.equal((await fetch(`${base}/untagged-books`)).status, 501);
    assert.equal((await fetch(`${base}/untagged-count`)).status, 501);
  });
});

// 실제 PostgreSQL 검증: 태그 관계가 하나도 없는 `books` 행만 나오는지, 태그를 붙이고 떼면 따라 바뀌는지 본다.
// 사용: PDFIT_TEST_DATABASE_URL=postgres://... node --test tests/untagged-books.test.mjs
test('PostgresMetadataStore lists only books without any tag', { skip: !process.env.PDFIT_TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: process.env.PDFIT_TEST_DATABASE_URL });
  const schema = `untagged_${process.pid}`;
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
      const names = async () => (await store.listUntaggedBooks()).map((book) => `${book.folder}/${book.filename}`);

      assert.deepEqual(await names(), ['Dev/a.pdf', 'Dev/b.pdf', 'Etc/c.pdf']);
      assert.equal(await store.countUntaggedBooks(), 3);

      await store.addTag('Dev', 'a.pdf', '프로그래밍');
      await store.addTag('Dev', 'a.pdf', '자바');
      assert.deepEqual(await names(), ['Dev/b.pdf', 'Etc/c.pdf'], '태그가 하나라도 있으면 미분류가 아니다');
      assert.equal(await store.countUntaggedBooks(), 2);
      assert.ok((await store.listUntaggedBooks()).every((book) => book.tags.length === 0));

      await store.removeTag('Dev', 'a.pdf', '프로그래밍');
      assert.deepEqual(await names(), ['Dev/b.pdf', 'Etc/c.pdf'], '태그가 하나 남아 있으면 여전히 미분류가 아니다');
      await store.removeTag('Dev', 'a.pdf', '자바');
      assert.deepEqual(await names(), ['Dev/a.pdf', 'Dev/b.pdf', 'Etc/c.pdf'], '마지막 태그를 떼면 다시 미분류가 된다');
      assert.equal(await store.countUntaggedBooks(), 3);
    } finally { client.release(); }
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  }
});
