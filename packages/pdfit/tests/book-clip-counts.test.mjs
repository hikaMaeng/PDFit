import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import pg from 'pg';
import { PostgresMetadataStore } from '../dist/server/postgres/index.js';

const connectionString = process.env.PDFIT_TEST_DATABASE_URL;

test('book counts backfill, follow committed writes, and initialize when a book is indexed', { skip: !connectionString }, async () => {
  const schema = `clip_counts_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}` });
  const store = new PostgresMetadataStore(pool, '.');
  const book = (folder, filename) => ({ folder, filename, size: 123, modified_at: 'fixture' });
  const insert = (db, folder, filename) => db.query(`
    INSERT INTO bookmarks (folder, filename, page_index, x, y, width, height, border_color, image_path)
    VALUES ($1, $2, 0, 0, 0, 16, 16, '#ffd353', 'fixture.jpg') RETURNING id
  `, [folder, filename]);
  const count = async (folder, filename) => (await store.listBooksByFolder(folder)).find((row) => row.filename === filename).clipCount;

  try {
    await store.ensureSchema();
    // Recreate the immediately preceding schema in this disposable namespace.
    await pool.query(`
      DROP TRIGGER initialize_book_clip_count ON books;
      DROP TRIGGER update_book_clip_count ON bookmarks;
      ALTER TABLE books DROP COLUMN clip_count, DROP COLUMN clip_count_revision;
      DELETE FROM schema_migrations WHERE id = 'book-clip-counts-v1';
    `);
    await pool.query("INSERT INTO books (folder, filename) VALUES ('A', 'same.pdf'), ('B', 'same.pdf')");
    await insert(pool, 'A', 'same.pdf');
    await insert(pool, 'A', 'same.pdf');
    await insert(pool, 'A', 'late.pdf');
    await store.ensureSchema();
    const initial = (await store.listBooksByFolder('A'))[0];
    assert.equal(initial.clipCount, 2);
    assert.equal(await count('B', 'same.pdf'), 0);
    await store.ensureSchema();
    assert.equal((await store.listBooksByFolder('A'))[0].clipCountRevision, initial.clipCountRevision);
    await store.syncBooks([book('A', 'same.pdf'), book('A', 'late.pdf')]);
    assert.equal(await count('A', 'same.pdf'), 2);
    assert.equal(await count('A', 'late.pdf'), 1);

    const actions = await Promise.all(Array.from({ length: 8 }, () => insert(pool, 'A', 'same.pdf')));
    assert.equal(await count('A', 'same.pdf'), 10);
    const afterInsert = (await store.searchBooksByTitle('same')).books.find((row) => row.folder === 'A');
    assert.equal(afterInsert.clipCount, 10);
    assert.ok(afterInsert.clipCountRevision > initial.clipCountRevision);
    await pool.query('UPDATE bookmarks SET comment = $1 WHERE id = $2', ['memo', actions[0].rows[0].id]);
    assert.equal((await store.searchBooksByTitle('same')).books.find((row) => row.folder === 'A').clipCountRevision, afterInsert.clipCountRevision);
    await store.addTag('A', 'same.pdf', 'Test');
    assert.equal((await store.listBooksByTag('Test'))[0].clipCount, 10);
    await store.setFavorite('A', 'same.pdf', true);
    assert.equal((await store.listFavoriteBooks())[0].clipCount, 10);
    assert.equal((await store.listUntaggedBooks()).find((row) => row.folder === 'B').clipCount, 0);

    await pool.query('DELETE FROM bookmarks WHERE id = ANY($1::uuid[])', [actions.map(({ rows }) => rows[0].id)]);
    assert.equal(await count('A', 'same.pdf'), 2);
    await pool.query("DELETE FROM bookmarks WHERE folder = 'A' AND filename = 'same.pdf'");
    assert.equal(await count('A', 'same.pdf'), 0);

    const addingClip = await pool.connect();
    const indexingBook = await pool.connect();
    try {
      await addingClip.query('BEGIN');
      await insert(addingClip, 'A', 'concurrent.pdf');
      const indexed = indexingBook.query("INSERT INTO books (folder, filename) VALUES ('A', 'concurrent.pdf')");
      const blocked = async () => (await pool.query(
        "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid = $1 AND locktype = 'advisory' AND NOT granted) AS waiting",
        [indexingBook.processID],
      )).rows[0].waiting;
      try {
        const deadline = Date.now() + 3_000;
        while (!(await blocked()) && Date.now() < deadline) await delay(10);
        assert.equal(await blocked(), true);
      } finally {
        await addingClip.query('COMMIT');
        await indexed;
      }
      assert.equal(await count('A', 'concurrent.pdf'), 1);
    } finally {
      addingClip.release();
      indexingBook.release();
    }
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
