import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { createBookmarksRouter } from '../src/server/api/bookmarks/index.ts';

test('missing document bookmark lookup reports an HTTP error without crashing the server', async () => {
  const app = express();
  app.use('/api/bookmarks', createBookmarksRouter(() => ({
    listBookmarks: async () => { throw new Error('Document is unavailable.'); },
  })));
  app.get('/health', (_req, res) => res.status(200).end());
  app.use((_error, _req, res, _next) => res.status(404).json({ error: 'Document is unavailable.' }));
  const server = app.listen(0); await once(server, 'listening');
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/bookmarks/Research/missing.pdf`);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, 'Document is unavailable.');
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
  } finally { server.close(); await once(server, 'close'); }
});
