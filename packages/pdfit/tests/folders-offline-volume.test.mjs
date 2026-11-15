import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import express from 'express';
import { createFoldersRouter } from '../dist/server/routes/folders.js';

// A library volume that never answers: every directory read hangs or fails.
function offlineFilesystem(behavior) {
  let reads = 0;
  return {
    reads: () => reads,
    fs: {
      booksRoot: '/offline', rootFolderName: 'Library',
      isRootFolder: (name) => name === 'Library',
      listFolderShells() { throw new Error('the request path must not read the volume synchronously'); },
      listChildFolderNames() { reads += 1; return behavior(); },
    },
  };
}

async function get(app, path) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const started = Date.now();
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
    return { status: response.status, body: await response.json(), ms: Date.now() - started };
  } finally { server.close(); server.closeAllConnections?.(); }
}

for (const [name, behavior] of [['hangs forever', () => new Promise(() => {})], ['fails with EHOSTDOWN', () => Promise.reject(new Error('EHOSTDOWN'))]]) {
  test(`folder list comes from the database while the library volume ${name}`, async () => {
    const { fs, reads } = offlineFilesystem(behavior);
    const router = createFoldersRouter(
      fs, undefined, undefined,
      async () => ({ Library: 715, AX: 4 }),
      async () => ({ AX: '#ef4444' }),
    );
    const app = express().use('/api/folders', router);
    const first = await get(app, '/api/folders');
    assert.equal(first.status, 200);
    assert.ok(first.ms < 1000, `answered in ${first.ms}ms`);
    assert.deepEqual(first.body.map((f) => [f.name, f.pdfCount, f.isRoot]), [['Library', 715, true], ['AX', 4, false]]);
    assert.equal(first.body[1].color, '#ef4444');
    const second = await get(app, '/api/folders');
    assert.equal(second.status, 200);
    assert.equal(reads(), 1, 'a hung or failed volume read is not repeated on every request');
  });
}

test('folders that exist only on disk are added once the volume answers', async () => {
  const { fs } = offlineFilesystem(async () => ['Empty']);
  const router = createFoldersRouter(fs, undefined, undefined, async () => ({ Library: 1 }), async () => ({}));
  const app = express().use('/api/folders', router);
  await get(app, '/api/folders');
  await new Promise((resolve) => setTimeout(resolve, 20));
  const { body } = await get(app, '/api/folders');
  assert.deepEqual(body.map((f) => f.name), ['Library', 'Empty']);
});
