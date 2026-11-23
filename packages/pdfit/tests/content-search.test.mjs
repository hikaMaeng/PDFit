import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import pg from 'pg';
import sharp from 'sharp';
import { restorePageOcrSearchIndex } from '../dist/server/ocr/pageOcrSearchIndex.js';
import { pageOcrCacheName } from '../dist/server/ocr/ocrService.js';
import { PostgresMetadataStore } from '../dist/server/postgres/index.js';
import { createSearchRouter } from '../dist/server/routes/search.js';

test('request dispatches exactly the selected search scope', async () => {
  const calls = [];
  const app = express();
  app.use(createSearchRouter(() => ({
    searchContent: async (...args) => { calls.push(args); return { hits: [], hasMore: false }; },
    searchBooksByTitle: async () => { calls.push(['title']); return { total: 0, books: [] }; },
  })));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/books?q=keyword`)).status, 200);
    assert.deepEqual(calls, [['title']]);
    for (const pathname of ['/content/invalid?q=keyword', '/content/outline?q=', '/content/outline?q=keyword&limit=101']) {
      assert.equal((await fetch(base + pathname)).status, 400);
    }
    const response = await fetch(`${base}/content/clip-memo?q=%20keyword%20&limit=5`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { hits: [], hasMore: false });
    assert.deepEqual(calls, [['title'], ['clip-memo', 'keyword', 5]]);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('OCR cache import accepts matching text results and skips malformed and old cache records', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pdfit-page-ocr-index-'));
  const calls = [];
  try {
    const records = [
      ['책.pdf', 'v2-1000-2', 3, { text: '본문', source: 'text-layer', pageIndex: 3 }],
      ['책.pdf', 'v1-1000-2', 3, { text: 'old', source: 'vision', pageIndex: 3 }],
      ['책.pdf', 'v2-1000-2', 5, { text: 'wrong page', source: 'vision', pageIndex: 6 }],
      ['unknown.pdf', 'v2-1000-2', 3, { text: 'unknown', source: 'text-layer', pageIndex: 3 }],
    ];
    await Promise.all(records.map(([name, stamp, pageIndex, body]) =>
      writeFile(path.join(directory, pageOcrCacheName('A', name, stamp, pageIndex)), JSON.stringify(body))));
    await writeFile(path.join(directory, pageOcrCacheName('A', '책.pdf', 'v2-1000-2', 8)), '{');
    await restorePageOcrSearchIndex(directory, 'v2', {
      listBooks: async () => [{ folder: 'A', filename: '책.pdf' }],
      save: async (...args) => { calls.push(args); },
    });
    assert.deepEqual(calls, [['A', '책.pdf', '1000-2', 3, '본문']]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('PostgreSQL indexes existing and changed text independently and filters stale sources', { skip: !process.env.PDFIT_TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: process.env.PDFIT_TEST_DATABASE_URL });
  const client = await pool.connect();
  const schema = `content_search_${process.pid}`;
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pdfit-content-search-'));
  try {
    await client.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}`);
    const store = new PostgresMetadataStore(client, directory);
    await store.ensureSchema();
    const folder = 'A';
    const filename = '예제.pdf';
    const book = { folder, filename, size: 42, modified_at: new Date(1000).toISOString() };
    const hits = async (scope, query) => (await store.searchContent(scope, query)).hits;
    await store.syncBooks([book]);
    await store.setBookOutline(folder, filename, [
      { key: '0', title: '공통 목차'.normalize('NFD'), page: 4, depth: 0 },
      { key: '1', title: '공통 정리', page: null, depth: 0 },
    ]);
    await client.query("DELETE FROM schema_migrations WHERE id = 'content-search-outline-v1'; DELETE FROM book_outline_search;");
    await store.ensureSchema();
    assert.equal((await hits('outline', '공통 목차'))[0].page, 4);
    assert.deepEqual(await hits('outline', '목차 정리'), [], 'terms must match within a single entry');
    assert.deepEqual(await store.searchContent('outline', '공통', 1), {
      hits: [{ id: '0', folder, filename, page: 4, snippet: '공통 목차' }], hasMore: true,
    });
    assert.deepEqual(await hits('outline', '!!!'), []);
    const image = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).png().toBuffer();
    const clip = await store.createBookmark(folder, filename, {
      pageIndex: 6, rect: { x: 0, y: 0, width: 0.5, height: 0.5 },
      borderColor: '#000000', comment: '공통 메모', imageBase64: image.toString('base64'),
    });
    const ocr = { text: '공통 인식', source: 'vision', error: null };
    await store.setBookmarkOcr(clip.id, { ...ocr, status: 'pending' });
    assert.deepEqual(await hits('clip-ocr', '인식'), []);
    await store.setBookmarkOcr(clip.id, { ...ocr, status: 'done' });
    assert.equal((await hits('clip-ocr', '공통 인식'))[0].page, 7);
    assert.equal((await hits('clip-memo', '공통 메모'))[0].id, clip.id);
    assert.deepEqual(await hits('clip-memo', '인식'), []);
    await store.updateBookmark(clip.id, { comment: null });
    assert.deepEqual(await hits('clip-memo', '메모'), []);
    await store.deleteBookmark(clip.id);
    assert.deepEqual(await hits('clip-ocr', '인식'), []);

    await store.savePageOcrText(folder, filename, '1000-42', 2, '공통 본문');
    assert.equal((await hits('page-ocr', '공통 본문'))[0].page, 3);
    await store.syncBooks([book]);
    assert.equal((await hits('page-ocr', '본문')).length, 1);
    await store.syncBooks([{ ...book, size: 43 }]);
    await store.savePageOcrText(folder, filename, '1000-42', 2, '공통 본문');
    assert.deepEqual(await hits('page-ocr', '본문'), []);
    assert.deepEqual(await hits('outline', '목차'), []);
    await store.setBookOutline(folder, filename, [{ key: '0', title: '새로운 목차', page: 3, depth: 0 }]);
    assert.equal((await hits('outline', '새로운'))[0].page, 3);
    await store.setBookOutline(folder, filename, []);
    assert.deepEqual(await hits('outline', '새로운'), []);
    await store.savePageOcrText(folder, filename, '1000-43', 2, '새로운 본문');
    await store.purgeFile(folder, filename);
    assert.deepEqual(await hits('page-ocr', '본문'), []);

    const { rows } = await client.query("SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexdef LIKE '% USING gin %' ORDER BY indexname", [schema]);
    assert.deepEqual(rows.map(({ indexname }) => indexname), ['idx_clip_memo_search_terms', 'idx_clip_ocr_search_terms', 'idx_outline_search_terms', 'idx_page_ocr_search_terms']);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    client.release();
    await pool.end();
    await rm(directory, { recursive: true, force: true });
  }
});
