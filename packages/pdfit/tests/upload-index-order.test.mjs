import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { createFoldersRouter } from '../dist/server/routes/folders.js';
import { createTagsRouter } from '../dist/server/routes/tags.js';
import { createFilesystemService } from '../dist/server/services/filesystem.js';
import { createWatcher } from '../dist/server/services/watcher.js';

test('uploads commit while a full scan is paused and supersede its stale snapshot', { timeout: 10_000 }, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'pdfit-upload-index-'));
  const filesystem = createFilesystemService(root, 'Library');
  const handles = [];
  const watch = fs.watch;
  t.mock.method(fs, 'watch', (...args) => {
    const handle = watch(...args);
    handles.push(handle);
    return handle;
  });
  const indexed = new Map();
  const writes = [];
  const scanPaused = Promise.withResolvers();
  const resumeScan = Promise.withResolvers();
  const scanApplied = Promise.withResolvers();
  let reads = 0;
  const store = {
    async syncBooks(books) {
      writes.push(books);
      for (const book of books) indexed.set(book.filename, book);
      if (books.some((book) => book.filename === 'external.pdf')) scanApplied.resolve();
    },
    async purgeFile(_folder, filename) { indexed.delete(filename); },
    async purgeFolder() {},
    async purgeOrphanTags() {},
    async listUntaggedBooks() { return [...indexed.values()].map((book) => ({ ...book, tags: [] })); },
  };
  const watcher = createWatcher({
    booksRoot: root,
    rootFolderName: 'Library',
    resolveFolderPath: filesystem.getFolderPath,
    metadataStore: store,
    volume: {
      isOffline: () => false,
      async run(operation) {
        const read = ++reads;
        const result = await operation();
        // Hold a snapshot that has already read both PDFs, including the old size.
        if (read === 4) {
          scanPaused.resolve();
          await resumeScan.promise;
        }
        return result;
      },
    },
  });
  await writeFile(path.join(root, 'external.pdf'), 'external');
  const app = express();
  app.use('/api/folders', createFoldersRouter(filesystem, watcher.refresh, undefined, undefined, undefined, undefined, watcher));
  app.use('/api/tags', createTagsRouter(store));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    resumeScan.resolve();
    for (const handle of handles) handle.close();
    const closed = once(server, 'close');
    server.close();
    await closed;
    await rm(root, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const upload = async (body) => {
    const form = new FormData();
    form.append('files', new Blob([body], { type: 'application/pdf' }), '한글.pdf');
    const response = await fetch(`${origin}/api/folders/Library/files`, {
      method: 'POST', body: form, signal: AbortSignal.timeout(4000),
    });
    assert.equal(response.status, 200);
    const [file] = await response.json();
    assert.equal(file.name, '한글.pdf');
    assert.ok(Number.isFinite(Date.parse(file.modifiedAt)));
    return file;
  };
  const list = async () => (await fetch(`${origin}/api/tags/untagged-books`)).json();

  assert.equal((await upload('%PDF-1.7')).size, 8);
  assert.deepEqual((await list()).map((book) => book.filename), ['한글.pdf']);
  assert.equal(reads, 0);
  await scanPaused.promise;
  assert.equal((await upload('%PDF-1.7 longer')).size, 15);
  assert.deepEqual((await list()).map((book) => [book.filename, book.size]), [['한글.pdf', 15]]);
  resumeScan.resolve();
  await scanApplied.promise;
  await watcher.refresh();
  assert.equal(indexed.get('한글.pdf').size, 15);
  assert.equal(indexed.get('external.pdf').size, 8);
  assert.ok(writes.slice(2).every((books) => books.find((book) => book.filename === '한글.pdf')?.size === 15));
});
