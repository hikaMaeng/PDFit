import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import express from 'express';
import { buildPdf } from './fixtures/pdfFixture.mjs';
import pageTextTask, { joinTextItems, meaningfulLength } from '../dist/server/ocr/pdfPageTextTask.worker.js';
import { createOcrService, pageOcrCacheName } from '../dist/server/ocr/ocrService.js';
import { cleanOcrOutput } from '../dist/server/ocr/visionOcr.js';
import { createOcrRouter } from '../dist/server/routes/ocr.js';
import { createBookmarksRouter } from '../dist/server/api/bookmarks/index.js';

const AI_URL = 'http://ai.test/v1/chat/completions';
const visionServer = { baseUrl: 'http://ai.test/v1', model: 'vision-model', timeoutMs: 5_000 };

function visionFetch({ answer = '스캔된 글자', status = 200 } = {}) {
  const calls = [];
  const request = async (input, init) => {
    assert.equal(String(input), AI_URL);
    const body = JSON.parse(init.body);
    calls.push(body);
    if (status !== 200) return new Response('{}', { status });
    return new Response(JSON.stringify({ choices: [{ message: { content: answer }, finish_reason: 'stop' }] }), { status: 200 });
  };
  return { request, calls };
}

/** Runs submitted tasks with the real worker script on this thread and settles them. */
function inlineScheduler(getService) {
  const submitted = [];
  const submit = (task) => {
    submitted.push(task);
    queueMicrotask(async () => {
      const started = Date.now();
      let outcome;
      try { outcome = { ok: true, result: await pageTextTask.run(task.payload, { id: 'x', type: 'page-text', key: task.key }), durationMs: Date.now() - started }; } catch (error) { outcome = { ok: false, error: { code: 'script-error', name: 'Error', message: error.message }, durationMs: 0 }; }
      getService().definition.onSettled({ key: task.key, payload: task.payload }, outcome);
    });
    return 'queued';
  };
  return { submit, submitted };
}

async function fixture() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfit-ocr-'));
  const textPdf = path.join(base, 'text.pdf');
  const blankPdf = path.join(base, 'blank.pdf');
  await fs.writeFile(textPdf, buildPdf({ label: 'PDFit OCR' }));
  await fs.writeFile(blankPdf, buildPdf({ label: '' }));
  return { base, textPdf, blankPdf };
}

test('text items are joined into lines; per-glyph items stay together', () => {
  const at = (str, x, baseline, width, hasEOL = false) => ({ str, x, baseline, top: baseline - 10, width, height: 10, hasEOL });
  assert.equal(joinTextItems([at('클', 0, 20, 10), at('린', 10, 20, 10), at('코드', 25, 20, 20), at('둘째 줄', 0, 40, 40)]), '클린 코드\n둘째 줄');
  assert.equal(joinTextItems([at('end', 0, 20, 20, true), at('next', 30, 20, 20)]), 'end\nnext');
  assert.equal(meaningfulLength(' \n\t '), 0);
  assert.equal(cleanOcrOutput('```text\nHello\r\nWorld\n```'), 'Hello\nWorld');
});

test('the worker reads the text layer, inside a rectangle, and renders only an area without text', async () => {
  const { base, textPdf, blankPdf } = await fixture();
  try {
    const page = await pageTextTask.run({ sourcePath: textPdf, pageIndex: 0 });
    assert.equal(page.text, 'PDFit OCR');
    assert.equal(page.pageCount, 1);
    assert.equal(page.pageWidth, 300);
    assert.equal(page.image, undefined);

    // The line sits at x=20, baseline y=200 in top-left points.
    const inside = await pageTextTask.run({ sourcePath: textPdf, pageIndex: 0, rect: { x: 0, y: 160, width: 300, height: 60 }, render: { width: 400, quality: 80 } });
    assert.equal(inside.text, 'PDFit OCR');
    assert.equal(inside.image, undefined, 'text was found, so nothing is rendered');

    const band = await pageTextTask.run({ sourcePath: textPdf, pageIndex: 0, rect: { x: 0, y: 0, width: 300, height: 100 }, render: { width: 400, quality: 80 } });
    assert.equal(band.text, '');
    assert.equal(band.matchedItems, 0);
    const jpeg = Buffer.from(band.image.jpegBase64, 'base64');
    assert.deepEqual([...jpeg.subarray(0, 3)], [0xff, 0xd8, 0xff]);
    assert.equal(band.image.width, 400);
    assert.equal(band.image.height, Math.ceil(100 * (400 / 300)));

    const blank = await pageTextTask.run({ sourcePath: blankPdf, pageIndex: 0, render: { width: 300, quality: 80 } });
    assert.equal(meaningfulLength(blank.text), 0);
    assert.ok(blank.image);

    await assert.rejects(pageTextTask.run({ sourcePath: textPdf, pageIndex: 3 }), /outside 1\.\.1/);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test('page OCR uses the text layer, caches it, and asks the vision model only for a page without text', async () => {
  const { base, textPdf, blankPdf } = await fixture();
  try {
    const files = { 'A\u0000text.pdf': textPdf, 'A\u0000blank.pdf': blankPdf };
    const network = visionFetch({ answer: '```\n스캔된 글자\n```' });
    let vision = visionServer;
    let service;
    const scheduler = inlineScheduler(() => service);
    service = createOcrService({
      resolveSourcePath: async (folder, filename) => files[`${folder}\u0000${filename}`] ?? null,
      sourceStamp: async () => '1-1',
      submit: scheduler.submit,
      resolveVisionServer: async () => vision,
      cacheRoot: path.join(base, 'ocr'),
      request: network.request,
    });

    const first = await service.recognizePage('A', 'text.pdf', 0);
    assert.deepEqual({ text: first.text, source: first.source, cached: first.cached, pageCount: first.pageCount }, { text: 'PDFit OCR', source: 'text-layer', cached: false, pageCount: 1 });
    assert.equal(network.calls.length, 0, 'a page with text never reaches the vision model');
    const second = await service.recognizePage('A', 'text.pdf', 0);
    assert.equal(second.cached, true);
    assert.equal(scheduler.submitted.length, 1, 'the cached result needs no task');
    await fs.stat(path.join(base, 'ocr', pageOcrCacheName('A', 'text.pdf', '1-1', 0)));

    const scanned = await service.recognizePage('A', 'blank.pdf', 0);
    assert.equal(scanned.source, 'vision');
    assert.equal(scanned.text, '스캔된 글자', 'a wrapping code fence is removed');
    assert.equal(network.calls.length, 1);
    const content = network.calls[0].messages[0].content;
    assert.equal(content[1].type, 'image_url');
    assert.match(content[1].image_url.url, /^data:image\/jpeg;base64,\/9j\//, 'the rendered page is sent as JPEG');
    assert.equal(network.calls[0].model, 'vision-model');

    vision = null;
    await fs.rm(path.join(base, 'ocr'), { recursive: true, force: true });
    const none = await service.recognizePage('A', 'blank.pdf', 0);
    assert.equal(none.source, 'none');
    assert.equal(none.text, '');
    await assert.rejects(fs.stat(path.join(base, 'ocr', pageOcrCacheName('A', 'blank.pdf', '1-1', 0))), 'an unreadable page is not cached');

    await assert.rejects(service.recognizePage('A', 'missing.pdf', 0), /File not found/);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test('a waited-for page task is part of every plan, so a periodic plan cannot drop it', async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfit-ocr-plan-'));
  try {
  const held = [];
  const service = createOcrService({
    resolveSourcePath: async () => '/x.pdf',
    sourceStamp: async () => '1-1',
    submit: (task) => { held.push(task); return 'queued'; },
    cacheRoot,
  });
  const pending = service.recognizePage('A', 'x.pdf', 2);
  for (let i = 0; i < 200 && held.length === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(held.length, 1, 'the request reached the queue');
  const plan = await service.definition.plan();
  assert.deepEqual(plan.map((task) => task.key), [held[0].key]);
  assert.equal(plan[0].payload.pageIndex, 2);
  service.definition.onSettled({ key: held[0].key, payload: held[0].payload }, { ok: true, result: { text: 'done', itemCount: 1, matchedItems: 1, pageCount: 3, pageWidth: 1, pageHeight: 1 }, durationMs: 1 });
  assert.equal((await pending).text, 'done');
  assert.deepEqual(await service.definition.plan(), [], 'a settled request leaves the plan');
  } finally {
    await fs.rm(cacheRoot, { recursive: true, force: true });
  }
});

test('clip OCR: text layer, then the clip image through the vision model, with failure states', async () => {
  const { base, textPdf, blankPdf } = await fixture();
  try {
    const clipImage = path.join(base, 'capture.jpg');
    await fs.writeFile(clipImage, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
    const records = new Map();
    const saved = [];
    const store = {
      listBookmarksWithOcrStatus: async (status) => [...records.values()].filter((record) => record.ocr?.status === status),
      getBookmark: async (id) => records.get(id) ?? null,
      setBookmarkOcr: async (id, ocr) => { saved.push([id, ocr]); const record = records.get(id); if (record) record.ocr = { ...ocr, updatedAt: 'now' }; return true; },
      imagePath: () => clipImage,
    };
    const bookmark = (id, filename, rect) => ({ id, folder: 'A', filename, pageIndex: 0, rect, imageUrl: `/api/bookmark-assets/${id}/capture.jpg` });
    let network = visionFetch({ answer: '클립 글자' });
    let vision = visionServer;
    let service;
    const scheduler = inlineScheduler(() => service);
    service = createOcrService({
      resolveSourcePath: async (folder, filename) => ({ 'text.pdf': textPdf, 'blank.pdf': blankPdf })[filename] ?? null,
      sourceStamp: async () => '1-1',
      submit: scheduler.submit,
      resolveVisionServer: async () => vision,
      cacheRoot: path.join(base, 'ocr'),
      bookmarks: store,
      request: (...args) => network.request(...args),
    });
    const settle = async (id) => { for (let i = 0; i < 200 && records.get(id).ocr?.status === 'pending'; i += 1) await new Promise((resolve) => setTimeout(resolve, 10)); return records.get(id).ocr; };

    records.set('t', bookmark('t', 'text.pdf', { x: 0, y: 160, width: 300, height: 60 }));
    assert.equal(await service.enqueueBookmark(records.get('t')), true);
    assert.deepEqual(saved[0], ['t', { status: 'pending', text: null, source: null, error: null }], 'marked pending before it runs');
    assert.deepEqual(await settle('t'), { status: 'done', text: 'PDFit OCR', source: 'text-layer', error: null, updatedAt: 'now' });
    assert.equal(network.calls.length, 0);

    records.set('v', bookmark('v', 'blank.pdf', { x: 0, y: 0, width: 300, height: 100 }));
    await service.enqueueBookmark(records.get('v'));
    assert.deepEqual(await settle('v'), { status: 'done', text: '클립 글자', source: 'vision', error: null, updatedAt: 'now' });
    assert.match(network.calls[0].messages[0].content[1].image_url.url, /^data:image\/jpeg;base64,/, 'the saved clip image is what the model reads');

    vision = null;
    records.set('u', bookmark('u', 'blank.pdf', { x: 0, y: 0, width: 300, height: 100 }));
    await service.enqueueBookmark(records.get('u'));
    assert.equal((await settle('u')).status, 'unavailable');

    vision = visionServer;
    network = visionFetch({ status: 500 });
    records.set('f', bookmark('f', 'blank.pdf', { x: 0, y: 0, width: 300, height: 100 }));
    await service.enqueueBookmark(records.get('f'));
    const failed = await settle('f');
    assert.equal(failed.status, 'failed');
    assert.match(failed.error, /500/);

    records.set('gone', bookmark('gone', 'deleted.pdf', { x: 0, y: 0, width: 1, height: 1 }));
    assert.equal(await service.enqueueBookmark(records.get('gone')), false, 'a clip whose PDF is gone is not queued');

    // A restart leaves clips pending; the next plan re-queues them.
    records.get('u').ocr = { status: 'pending', text: null, source: null, error: null, updatedAt: null };
    const plan = await service.definition.plan();
    assert.deepEqual(plan.map((task) => task.key), ['bookmark:u']);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test('bookmark and OCR routes: create queues OCR, retry, page endpoint validation', async () => {
  const enqueued = [];
  const ocr = { enqueueBookmark: async (record) => { enqueued.push(record.id); return record.filename !== 'remote.pdf'; } };
  const record = { id: '11111111-1111-4111-8111-111111111111', folder: 'A', filename: 'book.pdf', pageIndex: 0, rect: { x: 1, y: 1, width: 5, height: 5 } };
  const store = {
    createBookmark: async () => record,
    getBookmark: async (id) => (id === record.id ? record : null),
    setBookmarkOcr: async () => true,
  };
  const page = { recognizePage: async (folder, filename, pageIndex) => { if (filename === 'missing.pdf') throw Object.assign(new Error('File not found.'), { status: 404 }); return { text: 'T', source: 'text-layer', cached: false, pageIndex, pageCount: 1, durationMs: 1 }; } };
  const app = express();
  app.use(express.json());
  app.use('/api/bookmarks', createBookmarksRouter(store, ocr));
  app.use('/api/ocr', createOcrRouter(page));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body) => fetch(`${origin}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const created = await post('/api/bookmarks/A/book.pdf', { pageIndex: 0, rect: { x: 1, y: 1, width: 5, height: 5 }, borderColor: '#ff0000', imageMimeType: 'image/png', imageBase64: 'iVBORw0KGgo=' });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).ocr.status, 'pending');
    assert.deepEqual(enqueued, [record.id]);

    assert.equal((await post(`/api/bookmarks/${record.id}/ocr`, {})).status, 202);
    assert.equal((await post('/api/bookmarks/22222222-2222-4222-8222-222222222222/ocr', {})).status, 404);

    const ok = await post('/api/ocr/page', { folder: 'A', filename: 'book.pdf', pageIndex: 4 });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).pageIndex, 4);
    assert.equal((await post('/api/ocr/page', { folder: 'A', filename: 'book.pdf', pageIndex: -1 })).status, 400);
    assert.equal((await post('/api/ocr/page', { folder: 'A', filename: 'book.pdf', pageIndex: 1.5 })).status, 400);
    assert.equal((await post('/api/ocr/page', { folder: 'A', filename: 'missing.pdf', pageIndex: 0 })).status, 404);
  } finally {
    server.close();
  }
});
