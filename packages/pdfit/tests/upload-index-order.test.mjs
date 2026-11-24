import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import fs from 'node:fs';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { createFoldersRouter } from '../dist/server/routes/folders.js';
import { createTagsRouter } from '../dist/server/routes/tags.js';
import { createFilesystemService } from '../dist/server/services/filesystem.js';
import { createWatcher } from '../dist/server/services/watcher.js';

const FILENAME = '한글.pdf';
const ORIGINAL = '%PDF-1.7';
const REPLACEMENT = '%PDF-1.7 longer';
const EXTERNAL = 'external.pdf';
const ROOT_FOLDER = 'Library';
const bookPath = (folder, filename) => `/api/folders/${encodeURIComponent(folder)}/files/${encodeURIComponent(filename)}`;

function pause(t) {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  t.after(() => release.resolve());
  return { reached: entered.promise, resume: release.resolve, hold: () => { entered.resolve(); return release.promise; } };
}

async function fixture(t, hooks = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'pdfit-upload-index-'));
  const filesystem = createFilesystemService(root, ROOT_FOLDER);
  const indexed = new Map();
  const writes = [];
  const notifications = new Map();
  let reads = 0;
  t.mock.method(fs, 'watch', (dir, _options, notify) => {
    notifications.set(dir, notify);
    return Object.assign(new EventEmitter(), { close: () => notifications.delete(dir) });
  });
  const store = {
    async syncBooks(books) {
      await hooks.beforeWrite?.(books);
      writes.push(books);
      for (const book of books) indexed.set(book.filename, book);
    },
    async purgeFile(_folder, filename) { indexed.delete(filename); },
    async purgeFolder(folder) {
      for (const [filename, book] of indexed) if (book.folder === folder) indexed.delete(filename);
    },
    async purgeOrphanTags() {},
    async listUntaggedBooks() { return [...indexed.values()].map((book) => ({ ...book, tags: [] })); },
  };
  const watcher = createWatcher({
    booksRoot: root,
    rootFolderName: ROOT_FOLDER,
    resolveFolderPath: filesystem.getFolderPath,
    metadataStore: store,
    volume: {
      isOffline: () => false,
      async run(operation) {
        const read = ++reads;
        const result = await operation();
        await hooks.afterRead?.(read);
        return result;
      },
    },
  });
  const removeFile = filesystem.deleteFile;
  filesystem.deleteFile = async (...args) => {
    await removeFile(...args);
    await hooks.afterUnlink?.();
  };
  const mutations = {
    ...store,
    mutateFiles: (operation) => {
      hooks.onMutationQueued?.();
      return watcher.mutateFiles(operation);
    },
    commitUpload: (persist) => {
      hooks.onUploadQueued?.();
      return watcher.commitUpload(persist);
    },
  };
  const app = express();
  app.use('/api/folders', createFoldersRouter(filesystem, watcher.refresh, undefined, undefined, undefined, undefined, mutations));
  app.use('/api/tags', createTagsRouter(store));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    const closed = once(server, 'close');
    server.close();
    await closed;
    await watcher.refresh();
    await rm(root, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (route, options) => fetch(origin + route, { signal: AbortSignal.timeout(4000), ...options });
  const upload = async (body, folder = ROOT_FOLDER) => {
    const form = new FormData();
    form.append('files', new Blob([body], { type: 'application/pdf' }), FILENAME);
    const response = await request(`/api/folders/${encodeURIComponent(folder)}/files`, { method: 'POST', body: form });
    assert.equal(response.status, 200);
    const [file] = await response.json();
    assert.equal(file.name, FILENAME);
    assert.ok(Number.isFinite(Date.parse(file.modifiedAt)));
    return file;
  };
  const remove = async (route) => {
    const response = await request(route, { method: 'DELETE' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  };
  const list = async () => (await request('/api/tags/untagged-books')).json();
  return { root, filesystem, watcher, store, writes, upload, remove, list, notifications, reads: () => reads };
}

test('a second upload cancels the active scan and its replacement retries in the background', { timeout: 10_000 }, async (t) => {
  const scan = pause(t);
  const lib = await fixture(t, { afterRead: (read) => read === 2 ? scan.hold() : undefined });
  await writeFile(path.join(lib.root, EXTERNAL), 'external');
  assert.equal((await lib.upload(ORIGINAL)).size, ORIGINAL.length);
  assert.deepEqual((await lib.list()).map((book) => book.filename), [FILENAME]);
  await scan.reached;
  assert.equal((await lib.upload(REPLACEMENT)).size, REPLACEMENT.length);
  assert.deepEqual((await lib.list()).map((book) => book.size), [REPLACEMENT.length]);
  assert.equal(lib.reads(), 2);
  const refresh = lib.watcher.refresh();
  scan.resume();
  await refresh;
  assert.equal(lib.reads(), 5, 'the cancelled scan does not issue its remaining stat');
  assert.equal(lib.writes.length, 3);
  assert.equal(lib.writes.at(-1).find((book) => book.filename === FILENAME).size, REPLACEMENT.length);
  assert.ok((await lib.list()).some((book) => book.filename === EXTERNAL));
});

for (const kind of ['file', 'folder']) {
  test(`deleting a ${kind} during scanning prevents its old snapshot from restoring rows`, { timeout: 10_000 }, async (t) => {
    const scan = pause(t);
    const lib = await fixture(t, { afterRead: (read) => read === 3 ? scan.hold() : undefined });
    const folder = 'Child';
    await lib.filesystem.createFolder(folder);
    await lib.upload(ORIGINAL, folder);
    const refresh = lib.watcher.refresh();
    await scan.reached;
    await lib.remove(kind === 'file' ? bookPath(folder, FILENAME) : '/api/folders/Child');
    assert.deepEqual(await lib.list(), []);
    scan.resume();
    await refresh;
    assert.deepEqual(await lib.list(), []);
    assert.deepEqual(lib.writes.slice(1), [[]]);
  });
}

test('a same-name upload waits until unlink and metadata deletion finish', { timeout: 10_000 }, async (t) => {
  const unlink = pause(t);
  const queued = Promise.withResolvers();
  let uploads = 0;
  const lib = await fixture(t, {
    afterUnlink: unlink.hold,
    onUploadQueued: () => { if (++uploads === 2) queued.resolve(); },
  });
  await lib.upload(ORIGINAL);
  const deletion = lib.remove(bookPath(ROOT_FOLDER, FILENAME));
  await unlink.reached;
  const replacement = lib.upload(REPLACEMENT);
  await queued.promise;
  await assert.rejects(stat(path.join(lib.root, FILENAME)), { code: 'ENOENT' });
  unlink.resume();
  await deletion;
  assert.equal((await replacement).size, REPLACEMENT.length);
  await lib.watcher.refresh();
  assert.deepEqual((await lib.list()).map((book) => book.size), [REPLACEMENT.length]);
});

test('a delete is ordered after a scan write PostgreSQL has already started', { timeout: 10_000 }, async (t) => {
  const sql = pause(t);
  const deletionQueued = Promise.withResolvers();
  let writes = 0;
  const lib = await fixture(t, {
    beforeWrite: () => ++writes === 2 ? sql.hold() : undefined,
    onMutationQueued: deletionQueued.resolve,
  });
  await lib.upload(ORIGINAL);
  const refresh = lib.watcher.refresh();
  await sql.reached;
  const deletion = lib.remove(bookPath(ROOT_FOLDER, FILENAME));
  await deletionQueued.promise;
  assert.ok((await stat(path.join(lib.root, FILENAME))).isFile());
  sql.resume();
  await deletion;
  await refresh;
  assert.deepEqual(await lib.list(), []);
});

test('a watcher probe refused by the volume is not evidence of deletion', { timeout: 10_000 }, async (t) => {
  const warned = Promise.withResolvers();
  const denied = Object.assign(new Error('fixture permission denied'), { code: 'EACCES' });
  t.mock.method(console, 'warn', (_message, error) => { if (error === denied) warned.resolve(); });
  const lib = await fixture(t, { afterRead: (read) => { if (read === 3) throw denied; } });
  await lib.upload(ORIGINAL);
  await lib.watcher.refresh();
  lib.notifications.get(lib.root)('rename', FILENAME);
  await warned.promise;
  assert.deepEqual((await lib.list()).map((book) => book.filename), [FILENAME]);
});
