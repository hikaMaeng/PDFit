import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import express from 'express';
import {
  downloadCoverImage,
  isAllowedCoverImageUrl,
  parseOpenLibraryCoverCandidates,
  parseYes24CoverCandidates,
  sniffCoverImageType,
} from '../dist/server/covers/coverSources.js';
import { createCoverOverrideStore } from '../dist/server/covers/coverOverrideStore.js';
import { createCoversRouter } from '../dist/server/routes/covers.js';
import { createFoldersRouter } from '../dist/server/routes/folders.js';
import { createFilesystemService } from '../dist/server/services/filesystem.js';

// A JPEG large enough to pass the placeholder check: SOI marker plus padding.
const jpeg = (fill = 0x11, size = 4096) => { const bytes = Buffer.alloc(size, fill); bytes[0] = 0xff; bytes[1] = 0xd8; bytes[2] = 0xff; return bytes; };

function fakeFetch(routes) {
  const calls = [];
  const request = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, redirect: init.redirect });
    const route = routes[url];
    if (!route) return new Response('not found', { status: 404 });
    return typeof route === 'function' ? route() : route;
  };
  return { request, calls };
}

test('YES24 search HTML yields XL cover candidates with title scores', () => {
  const html = `
    <img class="lazy" data-original="https://image.yes24.com/goods/196209093/L" src="https://image.yes24.com/momo/Noimg_L.jpg" border="0" alt="클린 코드">
    <img class="lazy" data-original="https://image.yes24.com/goods/196209093/L" alt="클린 코드">
    <img class="lazy" data-original="https://image.yes24.com/goods/114667254/L" alt="파이썬 클린 코드 2nd Edition">
    <img class="lazy" data-original="https://image.yes24.com/goods/1/L" alt="">`;
  const candidates = parseYes24CoverCandidates(html, '클린 코드', 8);
  assert.equal(candidates.length, 2, 'duplicates and untitled images are skipped');
  assert.deepEqual(candidates[0], {
    source: 'YES24', title: '클린 코드',
    imageUrl: 'https://image.yes24.com/goods/196209093/XL',
    pageUrl: 'https://www.yes24.com/product/goods/196209093', score: 1,
  });
  assert.ok(candidates[1].score < 1);
});

test('Open Library payload yields only works with a cover id', () => {
  const candidates = parseOpenLibraryCoverCandidates({ docs: [
    { title: 'Clean Code', author_name: ['Robert C. Martin'], cover_i: 8065615, key: '/works/OL17618370W' },
    { title: 'No cover', author_name: ['Someone'] },
    { title: 'Bad id', cover_i: -1 },
  ] }, 'Clean Code', 8);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].imageUrl, 'https://covers.openlibrary.org/b/id/8065615-L.jpg');
  assert.equal(candidates[0].pageUrl, 'https://openlibrary.org/works/OL17618370W');
  assert.equal(candidates[0].authors, 'Robert C. Martin');
  assert.equal(parseOpenLibraryCoverCandidates(null, 'x', 8).length, 0);
});

test('only HTTPS cover hosts are accepted', () => {
  assert.equal(isAllowedCoverImageUrl('https://image.yes24.com/goods/1/XL'), true);
  assert.equal(isAllowedCoverImageUrl('https://covers.openlibrary.org/b/id/1-L.jpg'), true);
  assert.equal(isAllowedCoverImageUrl('https://ia802809.us.archive.org/view_archive.php?x=1'), true);
  assert.equal(isAllowedCoverImageUrl('http://image.yes24.com/goods/1/XL'), false, 'plain HTTP');
  assert.equal(isAllowedCoverImageUrl('https://example.com/a.jpg'), false, 'other host');
  assert.equal(isAllowedCoverImageUrl('https://image.yes24.com.evil.test/a.jpg'), false, 'suffix trick');
  assert.equal(isAllowedCoverImageUrl('https://user:pw@image.yes24.com/a.jpg'), false, 'credentials');
  assert.equal(isAllowedCoverImageUrl('https://image.yes24.com:8443/a.jpg'), false, 'non-default port');
  assert.equal(isAllowedCoverImageUrl('https://127.0.0.1/a.jpg'), false, 'loopback');
});

test('image type is decided by leading bytes', () => {
  assert.equal(sniffCoverImageType(jpeg()), 'image/jpeg');
  assert.equal(sniffCoverImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])), 'image/png');
  assert.equal(sniffCoverImageType(Buffer.from('RIFF0000WEBPVP8 ', 'latin1')), 'image/webp');
  assert.equal(sniffCoverImageType(Buffer.from('<html>')), null);
});

test('download follows allowed redirects and checks every hop', async () => {
  const chain = fakeFetch({
    'https://covers.openlibrary.org/b/id/1-L.jpg': new Response(null, { status: 302, headers: { location: 'https://archive.org/download/x.jpg' } }),
    'https://archive.org/download/x.jpg': new Response(null, { status: 302, headers: { location: 'https://ia1.us.archive.org/x.jpg' } }),
    'https://ia1.us.archive.org/x.jpg': () => new Response(jpeg(), { status: 200, headers: { 'content-type': 'image/jpeg' } }),
  });
  const image = await downloadCoverImage('https://covers.openlibrary.org/b/id/1-L.jpg', { request: chain.request });
  assert.equal(image.type, 'image/jpeg');
  assert.equal(image.finalUrl, 'https://ia1.us.archive.org/x.jpg');
  assert.ok(chain.calls.every((call) => call.redirect === 'manual'), 'redirects are followed by hand');

  const escape = fakeFetch({ 'https://image.yes24.com/goods/1/XL': new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } }) });
  await assert.rejects(downloadCoverImage('https://image.yes24.com/goods/1/XL', { request: escape.request }), /not allowed/);
  assert.equal(escape.calls.length, 1, 'the disallowed hop is never requested');

  const html = fakeFetch({ 'https://image.yes24.com/goods/2/XL': () => new Response('<html>'.repeat(400), { status: 200 }) });
  await assert.rejects(downloadCoverImage('https://image.yes24.com/goods/2/XL', { request: html.request }), /not a JPEG/);

  const tiny = fakeFetch({ 'https://image.yes24.com/goods/3/XL': () => new Response(jpeg(0x11, 200), { status: 200 }) });
  await assert.rejects(downloadCoverImage('https://image.yes24.com/goods/3/XL', { request: tiny.request }), /placeholder/);
});

test('override store keeps one image per file and supports restore and move', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfit-covers-'));
  try {
    const store = createCoverOverrideStore(root);
    const meta = { source: 'YES24', title: 'T', imageUrl: 'https://image.yes24.com/goods/1/XL' };
    const first = await store.set('A', 'book.pdf', { bytes: jpeg(0x11), type: 'image/jpeg' }, meta);
    const second = await store.set('A', 'book.pdf', { bytes: jpeg(0x22), type: 'image/jpeg' }, meta);
    assert.notEqual(first.version, second.version);
    const images = (await fs.readdir(root)).filter((name) => name.endsWith('.jpg'));
    assert.equal(images.length, 1, 'replacing deletes the previous image');
    const current = await store.get('A', 'book.pdf');
    assert.equal(current.version, second.version);
    assert.equal((await fs.readFile(current.path))[5], 0x22);
    assert.deepEqual((await store.list()).map((item) => [item.folder, item.filename]), [['A', 'book.pdf']]);

    assert.equal(await store.move({ folder: 'A', filename: 'book.pdf' }, { folder: 'B', filename: 'book.pdf' }), true);
    assert.equal(await store.get('A', 'book.pdf'), null);
    assert.ok(await store.get('B', 'book.pdf'));

    assert.equal(await store.remove('B', 'book.pdf'), true);
    assert.equal(await store.get('B', 'book.pdf'), null);
    assert.deepEqual(await fs.readdir(root), [], 'restore leaves nothing behind');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('API applies a cover, serves it as the thumbnail with the c version, and restores', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfit-covers-api-'));
  const booksRoot = path.join(base, 'books');
  try {
    await fs.mkdir(path.join(booksRoot, 'Shelf'), { recursive: true });
    await fs.writeFile(path.join(booksRoot, 'Shelf', 'clean code.pdf'), '%PDF-1.4\n');
    const filesystem = createFilesystemService(booksRoot, 'Library');
    const store = createCoverOverrideStore(path.join(base, 'thumbnails', 'covers'));
    const cover = jpeg(0x33);
    const { request } = fakeFetch({ 'https://image.yes24.com/goods/196209093/XL': () => new Response(cover, { status: 200 }) });
    const events = [];
    const rendered = path.join(base, 'rendered.jpg');
    await fs.writeFile(rendered, jpeg(0x44));
    const thumbnails = { find: async () => null, resolve: async () => ({ state: 'ready', path: rendered }) };

    const app = express();
    app.use(express.json());
    app.use('/api/covers', createCoversRouter({ filesystem, store, request, notifyChange: (event) => events.push(event) }));
    app.use('/api/folders', createFoldersRouter(filesystem, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, thumbnails, store));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const thumbnailUrl = `${origin}/api/folders/Shelf/files/${encodeURIComponent('clean code.pdf')}/thumbnail`;
    try {
      const before = Buffer.from(await (await fetch(thumbnailUrl)).arrayBuffer());
      assert.equal(before[5], 0x44, 'rendered first page before replacement');

      const rejected = await fetch(`${origin}/api/covers`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder: 'Shelf', filename: 'clean code.pdf', imageUrl: 'https://example.com/x.jpg', source: 'YES24', title: 'x' }) });
      assert.equal(rejected.status, 400, 'a host outside the list is refused before any download');
      const missing = await fetch(`${origin}/api/covers`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder: 'Shelf', filename: 'nope.pdf', imageUrl: 'https://image.yes24.com/goods/196209093/XL', source: 'YES24', title: 'x' }) });
      assert.equal(missing.status, 404);

      const applied = await fetch(`${origin}/api/covers`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder: 'Shelf', filename: 'clean code.pdf', imageUrl: 'https://image.yes24.com/goods/196209093/XL', source: 'YES24', title: '클린 코드' }) });
      assert.equal(applied.status, 200);
      const { version } = await applied.json();
      assert.deepEqual(events, ['folders-changed']);

      const listed = await (await fetch(`${origin}/api/covers`)).json();
      assert.deepEqual(listed.overrides.map((item) => [item.folder, item.filename, item.version]), [['Shelf', 'clean code.pdf', version]]);

      const unversioned = await fetch(thumbnailUrl);
      assert.equal(unversioned.headers.get('cache-control'), 'no-cache');
      assert.equal(Buffer.from(await unversioned.arrayBuffer())[5], 0x33, 'the chosen cover replaces the rendered page');
      const versioned = await fetch(`${thumbnailUrl}?v=1-1&c=${version}`);
      assert.match(versioned.headers.get('cache-control'), /immutable/);

      const restored = await fetch(`${origin}/api/covers?folder=Shelf&filename=${encodeURIComponent('clean code.pdf')}`, { method: 'DELETE' });
      assert.deepEqual(await restored.json(), { removed: true });
      const after = Buffer.from(await (await fetch(thumbnailUrl)).arrayBuffer());
      assert.equal(after[5], 0x44, 'restoring brings back the rendered page');
    } finally {
      server.close();
    }
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
