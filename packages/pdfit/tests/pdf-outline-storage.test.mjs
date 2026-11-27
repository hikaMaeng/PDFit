// 빌드 산출물 기준: `npm run build --workspace=@pdfit/pdfit` 후 `node --test packages/pdfit/tests/pdf-outline-storage.test.mjs`.
// 실제 PostgreSQL 검증은 PDFIT_TEST_DATABASE_URL=postgres://... 가 있을 때만 돈다.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { describe, it } from 'node:test';
import express from 'express';
import pg from 'pg';
import { loadOutlineWithStorage, tryReadPdfOutline } from '../dist/front/viewer/storedOutline.js';
import { createOutlinesRouter } from '../dist/server/routes/outlines.js';
import { PostgresMetadataStore } from '../dist/server/postgres/index.js';

const ENTRIES = [
  { key: '0', title: 'Chapter 1', depth: 0, page: 1 },
  { key: '0.0', title: 'Section 1.1', depth: 1, page: 2 },
  { key: '1', title: '부록', depth: 0, page: null },
];

function memoryStorage(initial = null, { saveOk = true } = {}) {
  const calls = { load: 0, save: [] };
  let stored = initial;
  return {
    calls,
    storage: {
      load: async () => { calls.load += 1; return stored; },
      initialize: async (entries) => {
        calls.save.push(entries);
        if (stored !== null) return 'exists';
        if (!saveOk) return 'failed';
        stored = entries;
        return 'saved';
      },
    },
  };
}

describe('stored table of contents (viewer side)', () => {
  it('answers from storage without reading the PDF when an outline is stored', async () => {
    const { storage, calls } = memoryStorage(ENTRIES);
    let reads = 0;
    const result = await loadOutlineWithStorage(async () => { reads += 1; return { status: 'ok', entries: [] }; }, storage);
    assert.deepEqual(result, { result: { status: 'ok', entries: ENTRIES, source: 'stored' }, canSave: true });
    assert.equal(reads, 0);
    assert.equal(calls.save.length, 0);
  });

  it('reads the PDF once, stores the successful result, and answers the next open from storage', async () => {
    const { storage, calls } = memoryStorage(null);
    let reads = 0;
    const read = async () => { reads += 1; return { status: 'ok', entries: ENTRIES }; };
    assert.deepEqual((await loadOutlineWithStorage(read, storage)).result, { status: 'ok', entries: ENTRIES, source: 'pdf', saved: true });
    assert.deepEqual(calls.save, [ENTRIES]);
    assert.deepEqual((await loadOutlineWithStorage(read, storage)).result, { status: 'ok', entries: ENTRIES, source: 'stored' });
    assert.equal(reads, 1);
  });

  it('never stores a failed lookup', async () => {
    for (const reason of ['empty', 'error']) {
      const { storage, calls } = memoryStorage(null);
      assert.deepEqual((await loadOutlineWithStorage(async () => ({ status: 'failed', reason }), storage)).result, { status: 'failed', reason });
      assert.equal(calls.save.length, 0, reason);
    }
  });

  it('allows retry after a failed storage lookup even if the PDF has no outline', async () => {
    const { storage } = memoryStorage();
    const read = async () => ({ status: 'failed', reason: 'empty' });
    const failed = await loadOutlineWithStorage(read, { ...storage, load: async () => { throw new Error('Timed out'); } });
    assert.deepEqual(failed, { result: { status: 'failed', reason: 'error' }, canSave: false });
    const unsupported = await loadOutlineWithStorage(read, { ...storage, load: async () => undefined });
    assert.deepEqual(unsupported, { result: { status: 'failed', reason: 'empty' }, canSave: false });
  });

  it('cancels a stalled PDF read, reports an error and allows another read', async ({ mock }) => {
    mock.timers.enable({ apis: ['setTimeout'] });
    let readSignal;
    const reading = tryReadPdfOutline((signal) => {
      readSignal = signal;
      return new Promise(() => {});
    });
    mock.timers.tick(30_000);
    assert.deepEqual(await reading, { status: 'failed', reason: 'error' });
    assert.equal(readSignal.aborted, true);
    assert.deepEqual(await tryReadPdfOutline(async () => ({ status: 'ok', entries: ENTRIES })), {
      status: 'ok', entries: ENTRIES,
    });
  });

  it('still shows a fresh outline when the server does not store it', async () => {
    const { storage } = memoryStorage(null, { saveOk: false });
    assert.deepEqual((await loadOutlineWithStorage(async () => ({ status: 'ok', entries: ENTRIES }), storage)).result, { status: 'ok', entries: ENTRIES, source: 'pdf', saved: false });
  });

  it('shows YES24 headings without permanently caching an all-unlinked outline', async () => {
    const { storage, calls } = memoryStorage(null);
    const entries = ENTRIES.map((entry) => ({ ...entry, page: null }));
    const result = await loadOutlineWithStorage(async () => ({ status: 'ok', entries, source: 'yes24' }), storage);
    assert.deepEqual(result.result, { status: 'ok', entries, source: 'yes24', saved: false });
    assert.equal(calls.save.length, 0);
  });

  it('does not restore a deleted outline, including when another viewer deletes it during the first read', async () => {
    const { storage, calls } = memoryStorage([]);
    const read = async () => { throw new Error('Must not read PDF'); };
    assert.deepEqual(await loadOutlineWithStorage(read, storage), { result: { status: 'deleted' }, canSave: true });
    assert.equal(calls.save.length, 0);

    let deleted = false;
    const racingStorage = {
      load: async () => deleted ? [] : null,
      initialize: async () => 'exists',
    };
    assert.deepEqual(await loadOutlineWithStorage(async () => {
      deleted = true;
      return { status: 'ok', entries: ENTRIES };
    }, racingStorage), {
      result: { status: 'deleted' }, canSave: true,
    });
  });
});

async function withServer(store, run, request) {
  const app = express();
  app.use(express.json());
  app.use('/api/outlines', createOutlinesRouter(store, request));
  const server = app.listen(0); await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}/api/outlines`); }
  finally { server.close(); await once(server, 'close'); }
}

describe('/api/outlines', () => {
  it('verifies the YES24 ISBN, retains line breaks and refuses a similar title', async () => {
    const calls = [];
    const request = async (url) => {
      calls.push(String(url));
      return new Response(String(url).includes('/search?')
        ? '<a class="gd_name" href="/product/goods/123">Sample Study: Introduction</a>'
        : `<th scope="row">ISBN13</th><td>9780306406157</td>
           <div id="infoset_toc"><textarea class="txtContentText">Chapter 1&lt;br /&gt;1.1 First lesson</textarea></div>`);
    };
    await withServer({}, async (base) => {
      const matched = await fetch(`${base}/A/Sample%20Study.pdf/yes24?isbn=9780306406157`);
      assert.deepEqual(await matched.json(), { title: 'Sample Study: Introduction', contents: 'Chapter 1\n1.1 First lesson' });
      assert.equal(new URL(calls[0]).searchParams.get('query'), '9780306406157');
      assert.equal(new URL(calls[0]).searchParams.get('domain'), 'ALL');
      assert.equal((await fetch(`${base}/A/Sample%20Study.pdf/yes24?isbn=9780306406158`)).status, 404);
      assert.equal((await fetch(`${base}/A/Sample%20Studies.pdf/yes24`)).status, 404);
      assert.equal(calls.length, 5);
    }, request);
  });
  it('stores a valid outline and returns it; 404 before', async () => {
    const rows = new Map();
    const store = {
      getBookOutline: async (folder, filename) => rows.get(`${folder}/${filename}`) ?? null,
      setBookOutline: async (folder, filename, entries) => { rows.set(`${folder}/${filename}`, entries); },
    };
    await withServer(store, async (base) => {
      const url = `${base}/${encodeURIComponent('개발')}/${encodeURIComponent('책.pdf')}`;
      assert.equal((await fetch(url)).status, 404);
      const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries: ENTRIES }) });
      assert.equal(put.status, 200);
      assert.deepEqual(await (await fetch(url)).json(), { entries: ENTRIES });
    });
  });

  it('rejects an empty or malformed outline with 400', async () => {
    const store = { getBookOutline: async () => null, setBookOutline: async () => { throw new Error('must not be called'); } };
    await withServer(store, async (base) => {
      for (const entries of [[], [{ key: '0', title: 'x', depth: 0, page: 0 }], [{ key: '0', title: 'x', depth: 0, page: 1 }, { key: '0', title: 'y', depth: 0, page: 2 }], 'nope']) {
        const response = await fetch(`${base}/A/b.pdf`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries }) });
        assert.equal(response.status, 400, JSON.stringify(entries));
      }
    });
  });

  it('persists deletion and rejects automatic initialization until explicitly restored', async () => {
    let entries = ENTRIES;
    const store = {
      getBookOutline: async () => entries,
      setBookOutline: async (folder, filename, next) => { entries = next; },
      initializeBookOutline: async () => false,
    };
    await withServer(store, async (base) => {
      const url = `${base}/A/b.pdf`;
      const headers = { 'Content-Type': 'application/json', 'If-None-Match': '*' };
      const body = JSON.stringify({ entries: ENTRIES });
      assert.equal((await fetch(url, { method: 'DELETE' })).status, 204);
      assert.equal((await fetch(url, { method: 'PUT', headers, body })).status, 412);
      assert.deepEqual(await (await fetch(url)).json(), { entries: [] });
      assert.equal((await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body })).status, 200);
      assert.deepEqual(await (await fetch(url)).json(), { entries: ENTRIES });
    });
  });

  it('answers 501 when the store does not keep outlines', async () => {
    await withServer({}, async (base) => {
      assert.equal((await fetch(`${base}/A/b.pdf`)).status, 501);
      assert.equal((await fetch(`${base}/A/b.pdf`, { method: 'DELETE' })).status, 501);
      const put = await fetch(`${base}/A/b.pdf`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries: ENTRIES }) });
      assert.equal(put.status, 501);
    });
  });
});

it('PostgresMetadataStore keeps an outline until the PDF changes, moves or is removed', { skip: !process.env.PDFIT_TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: process.env.PDFIT_TEST_DATABASE_URL });
  const schema = `outlines_${process.pid}`;
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO ${schema}`);
      const store = new PostgresMetadataStore({ query: (...args) => client.query(...args), connect: async () => client }, '.');
      await store.ensureSchema();
      await store.syncBooks([
        { folder: 'Dev', filename: 'a.pdf', size: 100, modified_at: '2026-11-01T00:00:00.000Z' },
        { folder: 'Dev', filename: 'b.pdf', size: 200, modified_at: '2026-11-01T00:00:00.000Z' },
      ]);

      assert.equal(await store.getBookOutline('Dev', 'a.pdf'), null, 'nothing stored yet');
      assert.equal(await store.initializeBookOutline('Dev', 'a.pdf', ENTRIES), true);
      assert.deepEqual(await store.getBookOutline('Dev', 'a.pdf'), ENTRIES);
      assert.equal(await store.getBookOutline('Dev', 'b.pdf'), null, 'another book has its own row');

      const volumes = [1, 2].map((page) => ({ key: String(page - 1), title: String(page), depth: 0, page }));
      await store.setBookOutline('Dev', 'b.pdf', volumes, undefined, true);
      assert.equal(await store.getBookOutline('Dev', 'b.pdf'), null, 'legacy scan-volume bookmarks are skipped');
      assert.equal(await store.initializeBookOutline('Dev', 'b.pdf', ENTRIES), true, 'new outline replaces the placeholders');
      await store.setBookOutline('Dev', 'b.pdf', volumes);
      assert.deepEqual(await store.getBookOutline('Dev', 'b.pdf'), volumes, 'numeric titles from a manual edit are preserved');
      assert.equal(await store.initializeBookOutline('Dev', 'b.pdf', ENTRIES), false);
      await client.query("UPDATE book_outlines SET is_manually_edited = NULL WHERE folder = 'Dev' AND filename = 'b.pdf'");
      assert.deepEqual(await store.getBookOutline('Dev', 'b.pdf'), volumes, 'older titles with unknown provenance are also preserved');
      assert.equal(await store.initializeBookOutline('Dev', 'b.pdf', ENTRIES), false);

      // Replacing the stored copy keeps one row per book.
      await store.setBookOutline('Dev', 'a.pdf', ENTRIES.slice(0, 1));
      assert.deepEqual(await store.getBookOutline('Dev', 'a.pdf'), ENTRIES.slice(0, 1));
      const count = await client.query('SELECT COUNT(*)::int AS n FROM book_outlines');
      assert.equal(count.rows[0].n, 2);

      await store.setBookOutline('Dev', 'a.pdf', []);
      assert.equal(await store.initializeBookOutline('Dev', 'a.pdf', ENTRIES), false);
      assert.deepEqual(await store.getBookOutline('Dev', 'a.pdf'), []);

      // The PDF was replaced (new size / modified time): the stored outline is no longer used.
      await store.syncBooks([{ folder: 'Dev', filename: 'a.pdf', size: 101, modified_at: '2026-11-02T00:00:00.000Z' }]);
      assert.equal(await store.getBookOutline('Dev', 'a.pdf'), null, 'stale after the file changed');
      assert.equal(await store.initializeBookOutline('Dev', 'a.pdf', ENTRIES), true);
      assert.deepEqual(await store.getBookOutline('Dev', 'a.pdf'), ENTRIES, 'stored again against the new file');

      // Move / delete path (folders router calls purgeFile on the old location) and folder removal.
      await store.purgeFile('Dev', 'a.pdf');
      assert.equal((await client.query("SELECT COUNT(*)::int AS n FROM book_outlines WHERE filename = 'a.pdf'")).rows[0].n, 0);
      await store.setBookOutline('Dev', 'b.pdf', ENTRIES);
      await store.purgeFolder('Dev');
      assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM book_outlines')).rows[0].n, 0);
    } finally { client.release(); }
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  }
});
