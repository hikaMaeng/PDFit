import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import express from 'express';
import { createLibraryVolumeGuard, LibraryOfflineError } from '../dist/server/services/libraryVolume.js';
import { createFilesystemService } from '../dist/server/services/filesystem.js';
import { createFoldersRouter } from '../dist/server/routes/folders.js';

const never = () => new Promise(() => undefined);

test('a hung call times out, opens the cooldown, and later calls never reach the disk', async () => {
  let clock = 0;
  const guard = createLibraryVolumeGuard({ timeoutMs: 20, cooldownMs: 1000, now: () => clock });
  await assert.rejects(guard.run(never), LibraryOfflineError);
  assert.equal(guard.isOffline(), true);
  let reached = 0;
  await assert.rejects(guard.run(async () => { reached += 1; }), LibraryOfflineError);
  assert.equal(reached, 0, 'no disk access during the cooldown');
  clock = 1001;
  assert.equal(await guard.run(async () => 'ok'), 'ok', 'the cooldown ends by time');
});

test('an unreachable-volume error code opens the cooldown; an ordinary error does not', async () => {
  const guard = createLibraryVolumeGuard({ cooldownMs: 1000 });
  await assert.rejects(guard.run(async () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); }), (error) => error.code === 'ENOENT');
  assert.equal(guard.isOffline(), false, 'a missing file is not an outage');
  await assert.rejects(guard.run(async () => { throw Object.assign(new Error('down'), { code: 'EHOSTDOWN' }); }), LibraryOfflineError);
  assert.equal(guard.isOffline(), true);
});

test('hung calls keep their slot, so at most maxInFlight of them reach the disk', async () => {
  const guard = createLibraryVolumeGuard({ timeoutMs: 5, maxInFlight: 2, cooldownMs: 0 });
  await Promise.allSettled([guard.run(never), guard.run(never)]);
  let reached = 0;
  await assert.rejects(guard.run(async () => { reached += 1; }), LibraryOfflineError);
  assert.equal(reached, 0);
});

test('folder counts skip PDF stats and many fast calls do not trip a disk timeout', async (context) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfit-listings-'));
  const shelf = path.join(base, 'Shelf');
  const files = ['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf', 'e.pdf', 'f.pdf'];
  try {
    await fs.mkdir(shelf);
    await Promise.all(files.map((name) => fs.writeFile(path.join(shelf, name), 'fixture')));
    await fs.writeFile(path.join(base, 'root.PDF'), 'fixture');
    await fs.writeFile(path.join(shelf, 'notes.txt'), 'fixture');
    const stat = fs.stat;
    let pdfStats = 0;
    context.mock.method(fs, 'stat', async (target) => {
      if (String(target).toLowerCase().endsWith('.pdf')) {
        pdfStats += 1;
        await new Promise((resolve) => setTimeout(resolve, 45));
      }
      return stat(target);
    });

    const guard = createLibraryVolumeGuard({ timeoutMs: 220 });
    const library = createFilesystemService(base, 'Library', guard);
    assert.deepEqual((await library.listFolders()).map(({ name, pdfCount }) => [name, pdfCount]), [['Library', 1], ['Shelf', 6]]);
    assert.equal(pdfStats, 0);
    assert.deepEqual((await library.listPdfs('Shelf')).map(({ name }) => name), files);
    assert.equal(pdfStats, 6);
    assert.equal(guard.isOffline(), false);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test('with the volume down, file work answers 503 and keeps the index; index-backed routes still answer', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfit-volume-'));
  try {
    const guard = createLibraryVolumeGuard({ timeoutMs: 20, cooldownMs: 60_000 });
    await assert.rejects(guard.run(never), LibraryOfflineError); // the mount hangs once
    const filesystem = createFilesystemService(path.join(base, 'books'), 'Library', guard);
    const purged = [];
    const books = [{ folder: 'Shelf', filename: 'a.pdf', size: 3, modified_at: '2026-01-01T00:00:00.000Z' }];
    const app = express();
    app.use(express.json());
    app.use('/api/folders', createFoldersRouter(
      filesystem, undefined, async () => books, async () => ({ Shelf: 1 }), async () => ({}), undefined,
      { purgeFile: async (folder, filename) => { purged.push([folder, filename]); }, purgeFolder: async () => undefined },
    ));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
      const list = await fetch(`${origin}/api/folders/Shelf/files`);
      assert.equal(list.status, 200, 'the file list comes from the index');
      assert.equal((await list.json())[0].name, 'a.pdf');
      assert.equal((await fetch(`${origin}/api/folders`)).status, 200, 'the folder list comes from the index');

      const removed = await fetch(`${origin}/api/folders/Shelf/files/a.pdf`, { method: 'DELETE' });
      assert.equal(removed.status, 503);
      assert.deepEqual(purged, [], 'a file that could not be deleted keeps its index row');
      assert.equal((await fetch(`${origin}/api/folders/Shelf/files/a.pdf`)).status, 503, 'opening a book reports the outage at once');
      const moved = await fetch(`${origin}/api/folders/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fromFolder: 'Shelf', toFolder: 'Other', filename: 'a.pdf' }) });
      assert.equal(moved.status, 503);
    } finally {
      server.close();
    }
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
