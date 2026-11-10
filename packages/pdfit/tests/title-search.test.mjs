// 빌드 산출물 기준: `npm run build --workspace=@pdfit/pdfit` 후 `node --test tests/title-search.test.mjs`.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import pg from 'pg';
import { createSearchRouter } from '../dist/server/api/search/index.js';
import { PostgresMetadataStore } from '../dist/server/postgres/index.js';
import { compactSearchText, titleChoseong } from '../dist/shared/choseong.js';

async function withServer(store, run) {
  const app = express();
  app.use('/api/search', createSearchRouter(store));
  const server = app.listen(0); await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}/api/search`); }
  finally { server.close(); await once(server, 'close'); }
}

test('search route passes the trimmed query to the metadata store and returns total with books', async () => {
  const calls = [];
  const store = { searchBooksByTitle: async (query, limit) => { calls.push({ query, limit }); return { total: 7, books: [{ folder: 'A', filename: 'x.pdf', size: 1, modified_at: '', tags: [] }] }; } };
  await withServer(store, async (base) => {
    const response = await fetch(`${base}/books?q=${encodeURIComponent('  자바 ')}&limit=20`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(calls, [{ query: '자바', limit: 20 }]);
    assert.equal(body.query, '자바');
    assert.equal(body.total, 7);
    assert.equal(body.books.length, 1);
  });
});

test('search route rejects an empty or oversized query and reports stores without title search as 501', async () => {
  await withServer({ searchBooksByTitle: async () => ({ total: 0, books: [] }) }, async (base) => {
    assert.equal((await fetch(`${base}/books`)).status, 400);
    assert.equal((await fetch(`${base}/books?q=%20%20`)).status, 400);
    assert.equal((await fetch(`${base}/books?q=${'a'.repeat(201)}`)).status, 400);
  });
  await withServer({}, async (base) => {
    assert.equal((await fetch(`${base}/books?q=abc`)).status, 501);
  });
});

// 실제 PostgreSQL 검증: 파일 시스템이 아니라 `books` 테이블을 조회하는지, 부분 문자열·NFC·대소문자 규칙이 맞는지 본다.
// 사용: PDFIT_TEST_DATABASE_URL=postgres://... node --test tests/title-search.test.mjs
test('PostgresMetadataStore.searchBooksByTitle matches substrings of titles in the books table', { skip: !process.env.PDFIT_TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: process.env.PDFIT_TEST_DATABASE_URL });
  const schema = `title_search_${process.pid}`;
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO ${schema}`);
      const store = new PostgresMetadataStore({ query: (...args) => client.query(...args), connect: async () => client }, '.');
      await store.ensureSchema();
      await store.syncBooks([
        { folder: 'Dev', filename: '이것이 자바다.pdf', size: 1, modified_at: 'a' },
        { folder: 'Dev', filename: 'Effective Java.pdf', size: 2, modified_at: 'b' },
        { folder: 'Etc', filename: 'JavaScript 100%_완성.PDF', size: 3, modified_at: 'c' },
        { folder: 'Etc', filename: '한글 NFD 책.pdf'.normalize('NFD'), size: 4, modified_at: 'd' },
        { folder: 'Etc', filename: 'readme-pdf-guide.pdf', size: 5, modified_at: 'e' },
      ]);
      await store.addTag('Dev', 'Effective Java.pdf', '프로그래밍');

      const titles = async (query) => (await store.searchBooksByTitle(query)).books.map((book) => `${book.folder}/${book.filename.normalize('NFC')}`);
      assert.deepEqual(await titles('자바'), ['Dev/이것이 자바다.pdf']);
      assert.deepEqual(await titles('java'), ['Dev/Effective Java.pdf', 'Etc/JavaScript 100%_완성.PDF']);
      assert.deepEqual(await titles('JAVA'), ['Dev/Effective Java.pdf', 'Etc/JavaScript 100%_완성.PDF']);
      assert.deepEqual(await titles('100%_'), ['Etc/JavaScript 100%_완성.PDF'], 'LIKE 와일드카드(% _)는 글자 그대로 비교해야 한다');
      assert.deepEqual(await titles('nfd 책'), ['Etc/한글 NFD 책.pdf'], 'NFD로 저장된 파일명도 NFC 검색어와 맞아야 한다');
      assert.deepEqual(await titles('pdf'), ['Etc/readme-pdf-guide.pdf'], '확장자 .pdf는 제목이 아니다');
      assert.deepEqual(await titles('Dev'), [], '폴더 이름은 검색 대상이 아니다');
      assert.deepEqual(await titles('프로그래밍'), [], '태그는 검색 대상이 아니다');
      const limited = await store.searchBooksByTitle('java', 1);
      assert.equal(limited.total, 2);
      assert.equal(limited.books.length, 1);
      assert.deepEqual(limited.books[0].tags.length, 1);
    } finally { client.release(); }
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  }
});

test('titleChoseong keeps only Hangul initials, drops whitespace and the extension, and leaves other characters', () => {
  assert.equal(titleChoseong('이것이 자바다.pdf'), 'ㅇㄱㅇㅈㅂㄷ');
  assert.equal(titleChoseong('Do it!SQL 입문.PDF'), 'doit!sqlㅇㅁ');
  assert.equal(titleChoseong('쌍둥이 뽀뽀.pdf'), 'ㅆㄷㅇㅃㅃ');
  assert.equal(titleChoseong('한글 책.pdf'.normalize('NFD')), 'ㅎㄱㅊ', 'NFD 파일명도 NFC로 모은 뒤 변환한다');
  assert.equal(titleChoseong('ㅅㅁㅇ 100.pdf'), 'ㅅㅁㅇ100', '이미 자모인 글자는 그대로 둔다');
  assert.equal(compactSearchText('  ㅇㄱㅇ  ㅈㅂㄷ '), 'ㅇㄱㅇㅈㅂㄷ');
});

// 초성 필드는 쓰기 경로(syncBooks)에서 만들고, 기존 행(NULL)은 스키마 준비 때 채우며, 검색은 제목과 초성을 동시에 본다.
test('title_choseong is written by syncBooks, backfilled for existing rows, and searched together with the title', { skip: !process.env.PDFIT_TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: process.env.PDFIT_TEST_DATABASE_URL });
  const schema = `title_choseong_${process.pid}`;
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO ${schema}`);
      const store = new PostgresMetadataStore({ query: (...args) => client.query(...args), connect: async () => client }, '.');
      await store.ensureSchema();
      await store.syncBooks([
        { folder: 'Dev', filename: '이것이 자바다.pdf', size: 1, modified_at: 'a' },
        { folder: 'Dev', filename: '정보 처리 기사.pdf', size: 2, modified_at: 'b' },
        { folder: 'Etc', filename: 'Do it!SQL 입문.pdf', size: 3, modified_at: 'c' },
      ]);
      const stored = async () => Object.fromEntries((await client.query('SELECT filename, title_choseong FROM books')).rows.map((row) => [row.filename, row.title_choseong]));
      assert.deepEqual(await stored(), { '이것이 자바다.pdf': 'ㅇㄱㅇㅈㅂㄷ', '정보 처리 기사.pdf': 'ㅈㅂㅊㄹㄱㅅ', 'Do it!SQL 입문.pdf': 'doit!sqlㅇㅁ' });

      const titles = async (query) => (await store.searchBooksByTitle(query)).books.map((book) => book.filename);
      assert.deepEqual(await titles('ㅇㄱㅇㅈㅂㄷ'), ['이것이 자바다.pdf'], '초성만으로 찾는다');
      assert.deepEqual(await titles('ㅇㄱㅇ ㅈㅂㄷ'), ['이것이 자바다.pdf'], '검색어의 공백은 무시한다');
      assert.deepEqual(await titles('ㅈㅂ'), ['이것이 자바다.pdf', '정보 처리 기사.pdf'], '초성은 제목 중간에서도 부분 일치한다');
      assert.deepEqual(await titles('자바'), ['이것이 자바다.pdf'], '완성형 검색어는 초성이 같은 다른 책(정보)에 일치하면 안 된다');
      assert.deepEqual(await titles('sql ㅇㅁ'), ['Do it!SQL 입문.pdf'], '영문과 초성을 섞어 쓴 검색어도 공백을 뺀 값으로 초성 필드에 일치한다');
      assert.deepEqual(await titles('sqlㅇㅁ'), ['Do it!SQL 입문.pdf'], '영문+초성이 붙어 있으면 초성 필드로 찾는다');

      // 기존 레코드: 컬럼은 있으나 값이 없는 행(과거 데이터, book_tags에서 보충된 행)은 스키마 준비 때 채워진다.
      await client.query('UPDATE books SET title_choseong = NULL');
      await store.addTag('Dev', '유령 문서.pdf', '태그');
      await store.ensureSchema();
      assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM books WHERE title_choseong IS NULL')).rows[0].n, 0);
      assert.equal((await stored())['유령 문서.pdf'], 'ㅇㄹㅁㅅ');
      assert.deepEqual(await titles('ㅇㄹㅁㅅ'), ['유령 문서.pdf']);

      // 재동기화(폴더 새로고침)는 값을 어긋나게 하지 않는다.
      await client.query("UPDATE books SET title_choseong = 'wrong'");
      await store.syncBooks([{ folder: 'Dev', filename: '이것이 자바다.pdf', size: 9, modified_at: 'z' }]);
      assert.equal((await stored())['이것이 자바다.pdf'], 'ㅇㄱㅇㅈㅂㄷ');
    } finally { client.release(); }
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  }
});
