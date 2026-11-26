import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';

const databaseUrl = process.env.PDFIT_TEST_DATABASE_URL;
const storeModule = process.env.PDFIT_TEST_STORE_MODULE;

test('recent books preserve registration time and cap the collection across folders', {
  skip: !databaseUrl && !storeModule,
}, async () => {
  const { PostgresMetadataStore } = await import(storeModule ?? '../dist/server/postgres/index.js');
  const client = new pg.Client({ connectionString: databaseUrl });
  const schema = `recent_books_${randomUUID().replaceAll('-', '')}`;
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
    await client.query(`
      CREATE TABLE books (
        folder TEXT NOT NULL, filename TEXT NOT NULL, size BIGINT NOT NULL DEFAULT 0,
        modified_at TEXT NOT NULL DEFAULT '', PRIMARY KEY (folder, filename)
      );
      INSERT INTO books (folder, filename, modified_at) VALUES
        ('Root', 'existing.pdf', '2024-01-01T00:00:00Z'),
        ('Root', 'unindexed.pdf', ''),
        ('Root', 'invalid-date.pdf', '2024-99-not-a-date');
    `);
    const store = new PostgresMetadataStore({
      query: (...args) => client.query(...args),
      connect: async () => ({ query: (...args) => client.query(...args), release() {} }),
    }, '.');
    await store.ensureSchema();
    const migrated = await store.listRecentBooks();
    assert.deepEqual(migrated.map(({ filename, registeredAt }) => [filename, registeredAt]), [
      ['existing.pdf', '2024-01-01T00:00:00.000Z'],
    ]);
    const fixture = Array.from({ length: 32 }, (_, index) => ({
      folder: index % 2 ? 'Other' : 'Root',
      filename: `book-${String(index).padStart(2, '0')}.pdf`,
      size: 1,
      modified_at: '2001-01-01T00:00:00Z',
    }));
    await store.syncBooks(fixture);
    const first = await store.listRecentBooks();
    const tieOrder = [...fixture].sort((left, right) =>
      left.folder.localeCompare(right.folder) || left.filename.localeCompare(right.filename));
    assert.equal(first.length, 30);
    assert.deepEqual(first.map((book) => book.filename), tieOrder.slice(0, 30).map((book) => book.filename));
    assert.equal(new Set(first.map((book) => book.registeredAt)).size, 1);

    await store.syncBooks([{ folder: 'Root', filename: 'new.pdf', size: 1, modified_at: '1999-01-01T00:00:00Z' }]);
    await store.addTag('Root', 'new.pdf', 'Sample');
    const [newest] = await store.listRecentBooks();
    assert.equal(newest.filename, 'new.pdf');
    assert.ok(newest.registeredAt >= first[0].registeredAt);
    assert.deepEqual(newest.tags, ['Sample']);

    const original = first[0];
    await store.syncBooks([{ ...original, size: 2, modified_at: '2099-01-01T00:00:00Z' }]);
    await store.relocateBook(original.folder, original.filename, 'Archive', {
      name: 'renamed.pdf', size: 2, modifiedAt: '2099-01-01T00:00:00Z',
    });
    await store.ensureSchema();
    const afterMove = await store.listRecentBooks();
    assert.equal(afterMove[0].filename, 'new.pdf');
    assert.equal(afterMove[1].folder, 'Archive');
    assert.equal(afterMove[1].filename, 'renamed.pdf');
    assert.equal(afterMove[1].size, 2);
    assert.equal(afterMove[1].registeredAt, original.registeredAt);
    assert.equal(afterMove.length, 30);
    await store.purgeFile('Root', 'new.pdf');
    const afterDelete = await store.listRecentBooks();
    assert.equal(afterDelete[0].filename, 'renamed.pdf');
    assert.equal(afterDelete.length, 30);
  } finally {
    try { await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { await client.end(); }
  }
});
