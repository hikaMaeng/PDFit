import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import express from 'express';
import pg from 'pg';
import { createPostgresMetadataStore } from '../dist/server/postgres/index.js';
import { createFoldersRouter } from '../dist/server/routes/folders.js';
import { createFilesystemService } from '../dist/server/services/filesystem.js';
import { createLibraryFileOperations } from '../dist/server/services/libraryFileOperations.js';
import operationScript from '../dist/server/services/libraryFileOperation.worker.js';
import { createWatcher } from '../dist/server/services/watcher.js';
import { TaskScheduler } from '../dist/server/tasks/taskScheduler.js';

const database = process.env.PDFIT_TEST_DATABASE_URL;

test('Free commits PDF mutations before disk I/O and reconciles them across scans and retries', { skip: !database, timeout: 20000 }, async (context) => {
  const schema = `file_operations_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: database });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: database, options: `-c search_path=${schema}` });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfit-file-operations-'));
  let runtime;
  let server;
  let pendingAttempt;
  context.after(async () => {
    pendingAttempt?.resolve();
    await runtime?.scheduler.whenIdle();
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    await fs.rm(root, { recursive: true, force: true });
  });
  const library = path.join(root, 'Library');
  const destination = path.join(library, 'Shelf');
  await fs.mkdir(destination, { recursive: true });
  const store = await createPostgresMetadataStore(pool, path.join(root, 'bookmarks'));
  const filesystem = createFilesystemService(library, 'Library');
  const watcher = createWatcher({ booksRoot: library, rootFolderName: 'Library', resolveFolderPath: filesystem.getFolderPath, metadataStore: store, watchDirectories: false });

  const holdAttempt = (runner) => {
    const gate = Promise.withResolvers();
    pendingAttempt = gate;
    runner.block = gate.promise;
    return gate.resolve;
  };
  function start() {
    const runner = {
      size: 1, busy: false, block: null, simulatedFailure: false,
      get idleSlots() { return this.busy ? 0 : 1; },
      async run({ payload }) {
        this.busy = true;
        try {
          await this.block;
          this.block = null;
          if (this.simulatedFailure) throw new Error('Simulated SMB outage');
          return { ok: true, result: await operationScript.run(payload), durationMs: 0 };
        } finally { this.busy = false; }
      },
    };
    const scheduler = new TaskScheduler({ intervalMs: 3600000, runner });
    const operations = createLibraryFileOperations(store.libraryFileOperations, filesystem, watcher, scheduler);
    return { operations, scheduler, runner };
  }

  runtime = start();
  const app = express().use(express.json());
  function router(operations) {
    return createFoldersRouter(filesystem, watcher.refresh, (folder) => store.listBooksByFolder(folder),
      undefined, undefined, undefined, {
        commitUpload: watcher.commitUpload, mutateFiles: watcher.mutateFiles,
        purgeFile: store.purgeFile.bind(store), purgeFolder: store.purgeFolder.bind(store),
      }, undefined, undefined, undefined, undefined, operations);
  }
  let foldersRouter = router(runtime.operations);
  app.use('/api/folders', (req, res, next) => foldersRouter(req, res, next));
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const origin = `http://127.0.0.1:${server.address().port}/api/folders`;
  const request = (url, method = 'GET', body) => fetch(`${origin}${url}`, {
    method, signal: AbortSignal.timeout(4000),
    ...(body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const rename = (filename, newName) => request('/files/rename', 'PATCH', { folder: 'Library', filename, newName });
  const names = async (folder = 'Library') => (await (await request(`/${folder}/files`)).json()).map(({ name }) => name);
  const create = async (filename, content = 'fixture contents') => {
    const file = path.join(library, filename);
    await fs.writeFile(file, content);
    const stat = await fs.stat(file);
    await store.syncBooks([{ folder: 'Library', filename, size: stat.size, modified_at: stat.mtime.toISOString() }]);
    return file;
  };

  const original = await create('original.pdf');
  await store.addTag('Library', 'original.pdf', 'fixture-tag');
  await store.bookComments.createBookComment({ folder: 'Library', filename: 'original.pdf' }, { id: randomUUID(), body: 'fixture comment' });
  let release = holdAttempt(runtime.runner);
  assert.equal((await rename('original.pdf', 'renamed.pdf')).status, 200);
  assert.deepEqual(await names(), ['renamed.pdf']);
  assert.deepEqual(await store.listBookTags('Library', 'renamed.pdf'), ['fixture-tag']);
  assert.equal((await store.bookComments.listBookComments({ folder: 'Library', filename: 'renamed.pdf' }, 1)).total, 1);
  assert.equal(await fs.readFile(original, 'utf8'), 'fixture contents');
  assert.equal(await (await request('/Library/files/renamed.pdf')).text(), 'fixture contents');
  assert.equal((await request('/Library/files/renamed.pdf', 'DELETE')).status, 409);
  assert.equal((await rename('original.pdf', 'renamed.pdf')).status, 200);
  const upload = new FormData();
  upload.append('files', new Blob(['replacement']), 'original.pdf');
  assert.equal((await fetch(`${origin}/Library/files`, { method: 'POST', body: upload })).status, 409);
  assert.equal((await request('/refresh', 'POST')).status, 200);
  assert.deepEqual(await names(), ['renamed.pdf'], 'a scan cannot reinsert a pending old path');
  release();
  await runtime.scheduler.whenIdle();
  await assert.rejects(fs.stat(original), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(library, 'renamed.pdf'), 'utf8'), 'fixture contents');

  runtime.runner.simulatedFailure = true;
  assert.equal((await request('/move', 'POST', { fromFolder: 'Library', toFolder: 'Shelf', filename: 'renamed.pdf' })).status, 200);
  assert.deepEqual(await names(), []);
  assert.deepEqual(await names('Shelf'), ['renamed.pdf']);
  await runtime.scheduler.whenIdle();
  assert.equal((await runtime.operations.status()).pending, 1);
  assert.match((await runtime.operations.status()).failures[0].error, /Simulated SMB outage/);
  assert.equal(await (await request('/Shelf/files/renamed.pdf')).text(), 'fixture contents');
  await runtime.scheduler.stop();
  runtime = start();
  foldersRouter = router(runtime.operations);
  await runtime.scheduler.planNow();
  await runtime.scheduler.whenIdle();
  assert.equal((await runtime.operations.status()).pending, 0);
  assert.equal(await fs.readFile(path.join(destination, 'renamed.pdf'), 'utf8'), 'fixture contents');
  assert.deepEqual(await store.listBookTags('Shelf', 'renamed.pdf'), ['fixture-tag']);

  const old = await create('conflict-source.pdf');
  release = holdAttempt(runtime.runner);
  assert.equal((await rename('conflict-source.pdf', 'external.pdf')).status, 200);
  await fs.writeFile(path.join(library, 'external.pdf'), 'external replacement');
  release();
  await runtime.scheduler.whenIdle();
  assert.equal(await fs.readFile(old, 'utf8'), 'fixture contents');
  assert.equal(await fs.readFile(path.join(library, 'external.pdf'), 'utf8'), 'external replacement');
  assert.deepEqual(await names(), ['conflict-source.pdf']);

  const waitingIO = Promise.withResolvers();
  const ioStarted = Promise.withResolvers();
  const inFlight = watcher.mutateFiles(() => { ioStarted.resolve(); return waitingIO.promise; });
  await ioStarted.promise;
  release = holdAttempt(runtime.runner);
  try {
    assert.equal((await request('/Shelf/files/renamed.pdf', 'DELETE')).status, 200);
    assert.deepEqual(await names('Shelf'), []);
    assert.deepEqual(await store.listBookTags('Shelf', 'renamed.pdf'), []);
    assert.equal(await fs.readFile(path.join(destination, 'renamed.pdf'), 'utf8'), 'fixture contents');
  } finally { waitingIO.resolve(); }
  await inFlight;
  assert.equal((await request('/refresh', 'POST')).status, 200);
  assert.deepEqual(await names('Shelf'), []);
  release();
  await runtime.scheduler.whenIdle();
  await assert.rejects(fs.stat(path.join(destination, 'renamed.pdf')), { code: 'ENOENT' });

  const stale = await create('already-absent.pdf');
  await fs.unlink(stale);
  assert.equal((await request('/Library/files/already-absent.pdf', 'DELETE')).status, 200);
  await runtime.scheduler.whenIdle();
  assert.equal((await names()).includes('already-absent.pdf'), false);
  const replaced = await create('replaced.pdf');
  release = holdAttempt(runtime.runner);
  assert.equal((await request('/Library/files/replaced.pdf', 'DELETE')).status, 200);
  assert.equal((await names()).includes('replaced.pdf'), false);
  await fs.writeFile(replaced, 'New contents written on the share');
  release();
  await runtime.scheduler.whenIdle();
  assert.equal(await fs.readFile(replaced, 'utf8'), 'New contents written on the share');
  assert.ok((await store.listBooksByFolder('Library')).some(({ filename, size }) => filename === 'replaced.pdf' && size === 33));
  assert.equal((await runtime.operations.status()).pending, 0);
});
