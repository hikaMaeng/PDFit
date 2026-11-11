// 빌드 산출물 기준: `npm run build --workspace=@pdfit/pdfit` 후 `node --test tests/tag-index.test.mjs`.
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

test('GET /index returns the store result and does not collide with a tag named "index"', async () => {
  const index = [{ name: '자바', color: '#2563eb', books: [{ folder: 'Dev', filename: 'a.pdf' }] }];
  const store = {
    listTagIndex: async () => index,
    listBooksByTag: async (tag) => [{ folder: 'T', filename: `${tag}.pdf`, size: 2, modified_at: '', tags: [tag] }],
  };
  await withServer(store, async (base) => {
    assert.deepEqual(await (await fetch(`${base}/index`)).json(), index);
    // 이름이 "index"인 실제 태그는 여전히 `/:tag/books`로 조회된다.
    assert.equal((await (await fetch(`${base}/index/books`)).json())[0].filename, 'index.pdf');
  });
});

test('GET /index reports 501 for stores that cannot build a tag index', async () => {
  await withServer({}, async (base) => {
    assert.equal((await fetch(`${base}/index`)).status, 501);
  });
});

// 실제 PostgreSQL 검증: 태그마다 책이 빠짐없이 묶이는지, `books`에 없는 연결과 책 없는 태그는 빠지는지,
// 한 책이 여러 태그 카드에 모두 나오는지, 태그를 떼면 따라 바뀌는지 본다.
// 사용: PDFIT_TEST_DATABASE_URL=postgres://... node --test tests/tag-index.test.mjs
test('PostgresMetadataStore groups every tag with all of its books in one query', { skip: !process.env.PDFIT_TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: process.env.PDFIT_TEST_DATABASE_URL });
  const schema = `tagindex_${process.pid}`;
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO ${schema}`);
      const store = new PostgresMetadataStore({ query: (...args) => client.query(...args), connect: async () => client }, '.');
      await store.ensureSchema();
      await store.syncBooks([
        { folder: 'Dev', filename: 'b.pdf', size: 2, modified_at: 'b' },
        { folder: 'Dev', filename: 'a.pdf', size: 1, modified_at: 'a' },
        { folder: 'Etc', filename: 'c.pdf', size: 3, modified_at: 'c' },
        { folder: 'Etc', filename: 'untagged.pdf', size: 4, modified_at: 'd' },
      ]);
      const names = async () => (await store.listTagIndex()).map((entry) => `${entry.name}:${entry.books.map((book) => `${book.folder}/${book.filename}`).join(',')}`);

      assert.deepEqual(await store.listTagIndex(), [], '태그가 없으면 빈 목록');

      await store.addTag('Dev', 'a.pdf', '프로그래밍');
      await store.addTag('Dev', 'b.pdf', '프로그래밍');
      await store.addTag('Dev', 'a.pdf', '자바');
      await store.addTag('Etc', 'c.pdf', '자바');
      assert.deepEqual(await names(), ['자바:Dev/a.pdf,Etc/c.pdf', '프로그래밍:Dev/a.pdf,Dev/b.pdf'], '한 책(a.pdf)이 두 태그에 모두 나온다');
      assert.ok((await store.listTagIndex()).every((entry) => /^#[0-9a-f]{6}$/i.test(entry.color)), '모든 카드에 색이 있다');

      // 요약·태그별 목록과 같은 숫자인지: 인덱스는 같은 데이터의 다른 모양이어야 한다.
      const summary = await store.listTagSummaries();
      for (const entry of await store.listTagIndex()) {
        assert.equal(entry.books.length, summary.find((item) => item.name === entry.name)?.bookCount, `${entry.name}: 인덱스 책 수 = 요약 bookCount`);
        assert.deepEqual(
          entry.books.map((book) => `${book.folder}/${book.filename}`),
          (await store.listBooksByTag(entry.name)).map((book) => `${book.folder}/${book.filename}`),
          `${entry.name}: 인덱스 책 목록 = listBooksByTag`,
        );
      }

      await store.removeTag('Dev', 'b.pdf', '프로그래밍');
      assert.deepEqual(await names(), ['자바:Dev/a.pdf,Etc/c.pdf', '프로그래밍:Dev/a.pdf']);
      await store.removeTag('Dev', 'a.pdf', '프로그래밍');
      assert.deepEqual(await names(), ['자바:Dev/a.pdf,Etc/c.pdf'], '책이 없어진 태그 카드는 사라진다');
    } finally { client.release(); }
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  }
});
