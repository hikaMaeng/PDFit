// Background task layer and the thumbnail job, run against the built package
// (`npm run build --workspace=@pdfit/pdfit` first). Real worker threads and real
// PDF.js rendering are used; only the scheduler-ordering tests use a fake runner.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { loadImage } from '@napi-rs/canvas';
import { TaskQueue } from '../dist/server/tasks/taskQueue.js';
import { TaskScheduler } from '../dist/server/tasks/taskScheduler.js';
import { TaskWorkerPool } from '../dist/server/tasks/taskWorkerPool.js';
import { createFilesystemService } from '../dist/server/services/filesystem.js';
import { createFoldersRouter } from '../dist/server/routes/folders.js';
import { createThumbnailStore, parseThumbnailFileName, thumbnailFileName, thumbnailSourceStamp } from '../dist/server/thumbnails/thumbnailStore.js';
import { createThumbnailService, THUMBNAIL_TASK_TYPE } from '../dist/server/thumbnails/thumbnailTask.js';
import { buildPdf } from './fixtures/pdfFixture.mjs';

const sampleScript = pathToFileURL(path.resolve(import.meta.dirname, 'fixtures/sample-task.mjs')).href;
const notATaskScript = pathToFileURL(path.resolve(import.meta.dirname, 'fixtures/not-a-task.mjs')).href;
const tick = () => new Promise((resolve) => setImmediate(resolve));

function envelope(type, key, priority = 0, extra = {}) {
  return { id: `${type}:${key}:${priority}`, type, key, script: sampleScript, payload: { value: key }, priority, timeoutMs: 5000, enqueuedAt: 0, ...extra };
}

/** Runner whose tasks finish only when the test says so. */
function manualRunner(size) {
  const active = new Map();
  return {
    size,
    get idleSlots() { return size - active.size; },
    run(task) { return new Promise((resolve) => active.set(task.key, resolve)); },
    finish(key, outcome = { ok: true, result: null, durationMs: 1 }) { const resolve = active.get(key); active.delete(key); resolve(outcome); },
    activeKeys: () => [...active.keys()],
    close: async () => {},
  };
}

test('queue orders by priority then submission, dedupes, promotes, and replaces one type', () => {
  const queue = new TaskQueue(5);
  assert.equal(queue.submit(envelope('a', '1')), 'queued');
  assert.equal(queue.submit(envelope('a', '2')), 'queued');
  assert.equal(queue.submit(envelope('b', '1')), 'queued');
  assert.equal(queue.submit(envelope('a', '1')), 'duplicate');
  assert.equal(queue.submit(envelope('a', '2', 100)), 'promoted');
  assert.equal(queue.size, 3);
  assert.equal(queue.sizeOf('a'), 2);

  const replaced = queue.replaceType('a', [envelope('a', '3'), envelope('a', '4'), envelope('a', '5'), envelope('a', '6'), envelope('a', '7')]);
  assert.deepEqual(replaced, { dropped: 2, queued: 4, rejected: 1 }, 'bound of 5 pending tasks: b:1 stays, four of type a fit');
  assert.equal(queue.has('b', '1'), true, 'another type is untouched by replaceType');
  assert.equal(queue.submit(envelope('c', '1', 50)), 'full');

  assert.equal(queue.submit(envelope('a', '5', 100)), 'promoted');
  assert.deepEqual([queue.take(), queue.take(), queue.take(), queue.take(), queue.take(), queue.take()].map((task) => task && `${task.type}:${task.key}`),
    ['a:5', 'b:1', 'a:3', 'a:4', 'a:6', undefined]);
});

test('scheduler respects the parallelism budget and a new plan replaces only pending work', async () => {
  const runner = manualRunner(2);
  let plan = ['1', '2', '3', '4', '5'];
  const settled = [];
  const scheduler = new TaskScheduler({ intervalMs: 3_600_000, concurrency: 2, runner });
  scheduler.register({ type: 'demo', script: sampleScript, plan: async () => plan.map((key) => ({ key, payload: { value: key } })), onSettled: (task, outcome) => { settled.push(`${task.key}:${outcome.ok}`); } });

  await scheduler.planNow();
  assert.deepEqual(runner.activeKeys(), ['1', '2'], 'two workers, two running tasks');
  assert.equal(scheduler.status().pending, 3);

  // The next schedule arrives while 1 and 2 are still running and 3..5 are waiting.
  plan = ['2', '6', '7'];
  await scheduler.planNow();
  const afterReplan = scheduler.status().types[0];
  assert.equal(afterReplan.planned, 3);
  assert.equal(afterReplan.pending, 2, 'pending 3,4,5 were dropped; running 2 is not queued again; 6 and 7 are queued');
  assert.deepEqual(runner.activeKeys(), ['1', '2'], 'running tasks are left to finish');

  runner.finish('1');
  await tick();
  assert.deepEqual(runner.activeKeys(), ['2', '6']);
  runner.finish('2', { ok: false, error: { code: 'script-error', name: 'Error', message: 'nope' }, durationMs: 1 });
  runner.finish('6');
  await tick();
  runner.finish('7');
  await scheduler.whenIdle();

  assert.deepEqual(settled, ['1:true', '2:false', '6:true', '7:true']);
  const status = scheduler.status().types[0];
  assert.equal(status.completedSincePlan, 3);
  assert.equal(status.failedSincePlan, 1);
  assert.equal(status.recentFailures[0].key, '2');
  assert.equal(status.pending + status.running, 0);
  await scheduler.stop();
});

test('scheduler keeps the previous queue when a plan fails and lets urgent submissions jump ahead', async () => {
  const runner = manualRunner(1);
  let fail = false;
  const scheduler = new TaskScheduler({ intervalMs: 3_600_000, concurrency: 1, runner });
  scheduler.register({ type: 'demo', script: sampleScript, plan: async () => { if (fail) throw new Error('library offline'); return ['1', '2', '3'].map((key) => ({ key, payload: {} })); } });
  await scheduler.planNow();
  assert.deepEqual(runner.activeKeys(), ['1']);

  fail = true;
  await scheduler.planNow();
  const status = scheduler.status().types[0];
  assert.equal(status.lastPlanError, 'library offline');
  assert.equal(status.pending, 2, 'a failed plan does not discard known work');

  assert.equal(scheduler.submit('demo', { key: '1', payload: {} }), 'running');
  assert.equal(scheduler.submit('demo', { key: '3', payload: {}, priority: 100 }), 'promoted');
  assert.equal(scheduler.submit('demo', { key: '9', payload: {}, priority: 100 }), 'queued');
  assert.equal(scheduler.submit('other', { key: '1', payload: {} }), 'unknown-type');
  const order = [];
  for (let step = 0; step < 4; step += 1) { const [key] = runner.activeKeys(); order.push(key); runner.finish(key); await tick(); }
  assert.deepEqual(order, ['1', '3', '9', '2']);
  await scheduler.whenIdle();
  await scheduler.stop();
});

test('scheduler timers run the first plan after the initial delay and again every interval', async () => {
  const runner = manualRunner(1);
  let plans = 0;
  const scheduler = new TaskScheduler({ intervalMs: 80, initialDelayMs: 20, concurrency: 1, runner });
  scheduler.register({ type: 'demo', script: sampleScript, plan: async () => { plans += 1; return []; } });
  scheduler.start();
  assert.equal(plans, 0);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(plans, 1, 'first plan follows the initial delay');
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.ok(plans >= 3, `the interval keeps planning (saw ${plans})`);
  await scheduler.stop();
  const stopped = plans;
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(plans, stopped, 'stop() ends the schedule');
});

test('worker pool runs standard task scripts in worker threads and survives errors and timeouts', async () => {
  const pool = new TaskWorkerPool({ size: 2 });
  try {
    const [first, second] = await Promise.all([pool.run(envelope('demo', 'a')), pool.run(envelope('demo', 'b'))]);
    assert.equal(first.ok && second.ok, true);
    assert.deepEqual([first.result.echoed, first.result.type, first.result.key], ['a', 'demo', 'a']);
    assert.notEqual(first.result.threadId, 0, 'the script ran off the main thread');
    assert.notEqual(first.result.threadId, second.result.threadId, 'two slots are two worker threads');
    assert.equal(pool.idleSlots, 2);
    await assert.rejects(Promise.all([pool.run(envelope('demo', 'x', 0, { payload: { mode: 'sleep', ms: 50 } })), pool.run(envelope('demo', 'y', 0, { payload: { mode: 'sleep', ms: 50 } })), pool.run(envelope('demo', 'z'))]), /No idle task worker/);
    await new Promise((resolve) => setTimeout(resolve, 120));

    const thrown = await pool.run(envelope('demo', 'c', 0, { payload: { mode: 'throw', value: 7 } }));
    assert.deepEqual([thrown.ok, thrown.error.code, thrown.error.name, thrown.error.message], [false, 'script-error', 'TypeError', 'boom 7']);

    const invalid = await pool.run(envelope('demo', 'd', 0, { script: notATaskScript }));
    assert.equal(invalid.ok, false);
    assert.match(invalid.error.message, /must default-export an object with run\(\)/);

    const started = performance.now();
    const hung = await pool.run(envelope('demo', 'e', 0, { payload: { mode: 'hang' }, timeoutMs: 300 }));
    assert.deepEqual([hung.ok, hung.error.code], [false, 'timeout']);
    assert.ok(performance.now() - started < 3000, 'a hung task is cut off near its timeout');

    const after = await pool.run(envelope('demo', 'f'));
    assert.equal(after.ok, true, 'the slot gets a fresh worker after a timeout');
    assert.equal(pool.idleSlots, 2);
  } finally {
    await pool.close();
  }
});

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfit-thumbnail-test-'));
  const booksRoot = path.join(root, 'books');
  const thumbnailRoot = path.join(root, 'thumbnails');
  fs.mkdirSync(path.join(booksRoot, 'Research'), { recursive: true });
  fs.writeFileSync(path.join(booksRoot, 'alpha.pdf'), buildPdf({ label: 'alpha', rgb: [0.8, 0.1, 0.1] }));
  fs.writeFileSync(path.join(booksRoot, 'Research', '한글 제목.pdf'), buildPdf({ label: 'beta', rgb: [0.1, 0.6, 0.2], width: 400, height: 300 }));
  fs.writeFileSync(path.join(booksRoot, 'Research', 'broken.pdf'), 'this is not a pdf');
  fs.writeFileSync(path.join(booksRoot, 'notes.txt'), 'ignored');
  const store = createThumbnailStore(thumbnailRoot);
  const scheduler = new TaskScheduler({ intervalMs: 3_600_000, concurrency: 2 });
  const service = createThumbnailService({ booksRoot, rootFolderName: 'Library', store, submit: (task) => scheduler.submit(THUMBNAIL_TASK_TYPE, task) });
  scheduler.register(service.definition);
  const stampOf = (...segments) => { const stat = fs.statSync(path.join(booksRoot, ...segments)); return thumbnailSourceStamp(stat.mtime.getTime(), stat.size); };
  const names = () => fs.existsSync(thumbnailRoot) ? fs.readdirSync(thumbnailRoot).sort() : [];
  return { root, booksRoot, thumbnailRoot, store, scheduler, service, stampOf, names, cleanup: async () => { await scheduler.stop(); fs.rmSync(root, { recursive: true, force: true }); } };
}

test('thumbnail job renders missing covers, skips fresh ones, and follows source changes', async () => {
  const lib = library();
  try {
    await lib.scheduler.planNow();
    assert.deepEqual({ ...lib.service.lastPlan(), at: null }, { at: null, sources: 3, ready: 0, failed: 0, queued: 3, removed: 0, complete: true });
    await lib.scheduler.whenIdle();

    const alphaName = thumbnailFileName('Library', 'alpha.pdf', lib.stampOf('alpha.pdf'), 'jpg');
    const betaName = thumbnailFileName('Research', '한글 제목.pdf', lib.stampOf('Research', '한글 제목.pdf'), 'jpg');
    const brokenFailure = thumbnailFileName('Research', 'broken.pdf', lib.stampOf('Research', 'broken.pdf'), 'failed');
    assert.deepEqual(lib.names(), [alphaName, betaName, brokenFailure].sort(), 'two JPEGs and one failure marker, no temporary files');

    const alpha = await loadImage(path.join(lib.thumbnailRoot, alphaName));
    const beta = await loadImage(path.join(lib.thumbnailRoot, betaName));
    assert.deepEqual([alpha.width, alpha.height], [360, 480], '300x400 page scaled to the 360px thumbnail width');
    assert.deepEqual([beta.width, beta.height], [360, 270], '400x300 page keeps its aspect ratio');
    const status = lib.scheduler.status().types[0];
    assert.deepEqual([status.completedSincePlan, status.failedSincePlan, status.recentFailures[0].key.startsWith('Research/broken.pdf@')], [2, 1, true]);
    assert.equal(JSON.parse(fs.readFileSync(path.join(lib.thumbnailRoot, brokenFailure), 'utf8')).filename, 'broken.pdf');

    // Nothing changed: the next schedule has nothing to do.
    await lib.scheduler.planNow();
    assert.deepEqual({ ...lib.service.lastPlan(), at: null }, { at: null, sources: 3, ready: 2, failed: 1, queued: 0, removed: 0, complete: true });

    // A modified PDF has a new stamp: its old thumbnail is removed and a new one is rendered.
    const alphaPath = path.join(lib.booksRoot, 'alpha.pdf');
    fs.writeFileSync(alphaPath, buildPdf({ label: 'alpha v2', rgb: [0.2, 0.2, 0.9] }));
    fs.utimesSync(alphaPath, new Date(), new Date(Date.now() + 60_000));
    fs.rmSync(path.join(lib.booksRoot, 'Research', '한글 제목.pdf'));
    await lib.scheduler.planNow();
    assert.deepEqual({ ...lib.service.lastPlan(), at: null }, { at: null, sources: 2, ready: 0, failed: 1, queued: 1, removed: 2, complete: true });
    await lib.scheduler.whenIdle();
    const newAlphaName = thumbnailFileName('Library', 'alpha.pdf', lib.stampOf('alpha.pdf'), 'jpg');
    assert.notEqual(newAlphaName, alphaName);
    assert.deepEqual(lib.names(), [newAlphaName, brokenFailure].sort(), 'stale and orphaned thumbnails are gone');
    assert.ok(lib.names().every((name) => parseThumbnailFileName(name)));
  } finally {
    await lib.cleanup();
  }
});

test('thumbnail cleanup is skipped when the library looks offline, and old failures are retried', async () => {
  const lib = library();
  try {
    await lib.scheduler.planNow();
    await lib.scheduler.whenIdle();
    const before = lib.names();
    assert.equal(before.length, 3);

    // An empty listing (for example an unmounted share) must not wipe valid thumbnails.
    const parked = path.join(lib.root, 'parked');
    fs.renameSync(lib.booksRoot, parked);
    fs.mkdirSync(lib.booksRoot);
    await lib.scheduler.planNow();
    assert.deepEqual([lib.service.lastPlan().sources, lib.service.lastPlan().removed], [0, 0]);
    assert.deepEqual(lib.names(), before);

    // A missing library root fails the plan instead of planning from nothing.
    fs.rmdirSync(lib.booksRoot);
    await lib.scheduler.planNow();
    assert.match(lib.scheduler.status().types[0].lastPlanError, /ENOENT/);
    assert.deepEqual(lib.names(), before);
    fs.renameSync(parked, lib.booksRoot);

    // With a zero retry window the recorded failure is attempted again.
    const retrying = createThumbnailService({ booksRoot: lib.booksRoot, rootFolderName: 'Library', store: lib.store, submit: () => 'queued', failureRetryMs: 0 });
    const planned = await retrying.definition.plan();
    assert.deepEqual(planned.map((task) => task.payload.filename), ['broken.pdf']);
  } finally {
    await lib.cleanup();
  }
});

test('thumbnail route serves ready covers, queues missing ones ahead of the backlog, and reports failures', async () => {
  const lib = library();
  const filesystem = createFilesystemService(lib.booksRoot, 'Library');
  const app = express();
  app.use('/api/folders', createFoldersRouter(filesystem, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, lib.service));
  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/folders`;
  const url = (folder, filename, stamp) => `${base}/${encodeURIComponent(folder)}/files/${encodeURIComponent(filename)}/thumbnail${stamp ? `?v=${stamp}` : ''}`;
  try {
    const alphaStamp = lib.stampOf('alpha.pdf');
    // No plan has run yet: asking for a cover queues it and answers 202.
    const queued = await fetch(url('Library', 'alpha.pdf', alphaStamp));
    assert.deepEqual([queued.status, (await queued.json()).state, queued.headers.get('cache-control')], [202, 'queued', 'no-store']);
    assert.equal(lib.scheduler.status().types[0].pending + lib.scheduler.status().types[0].running, 1);
    await lib.scheduler.whenIdle();

    const ready = await fetch(url('Library', 'alpha.pdf', alphaStamp));
    assert.deepEqual([ready.status, ready.headers.get('content-type'), ready.headers.get('cache-control')], [200, 'image/jpeg', 'public, max-age=31536000, immutable']);
    const bytes = Buffer.from(await ready.arrayBuffer());
    assert.deepEqual([bytes[0], bytes[1]], [0xff, 0xd8], 'JPEG start-of-image marker');

    // A client with an outdated stamp still gets the current cover, but not as immutable.
    const stale = await fetch(url('Library', 'alpha.pdf', '1-1'));
    assert.deepEqual([stale.status, stale.headers.get('cache-control')], [200, 'no-cache']);
    const unversioned = await fetch(url('Library', 'alpha.pdf'));
    assert.deepEqual([unversioned.status, unversioned.headers.get('cache-control')], [200, 'no-cache']);

    const broken = await fetch(url('Research', 'broken.pdf'));
    assert.equal(broken.status, 202);
    await lib.scheduler.whenIdle();
    const failed = await fetch(url('Research', 'broken.pdf'));
    assert.deepEqual([failed.status, (await failed.json()).state], [404, 'failed']);

    for (const [folder, filename] of [['Library', 'nope.pdf'], ['Nowhere', 'alpha.pdf'], ['Library', 'notes.txt'], ['Library', '../books/alpha.pdf']]) {
      const missing = await fetch(url(folder, filename));
      assert.deepEqual([missing.status, (await missing.json()).state], [404, 'missing'], `${folder}/${filename}`);
    }
    // fetch() normalises `..` path segments before sending, so traversal through the
    // folder name is checked on the lookup itself.
    for (const [folder, filename] of [['..', 'alpha.pdf'], ['Research/..', 'alpha.pdf'], ['Library', '..'], ['Research\\..', 'alpha.pdf']]) {
      assert.deepEqual(await lib.service.resolve(folder, filename), { state: 'missing' }, `${folder}/${filename}`);
    }
    assert.equal(lib.scheduler.status().pending, 0, 'invalid requests queue nothing');
  } finally {
    server.close();
    await once(server, 'close');
    await lib.cleanup();
  }
});

test('a hosted runtime reuses the shared scheduler entry and render script over authenticated HTTP', async () => {
  const { createPdfitTaskScheduler, readPdfitTaskSchedulerEnvironment, THUMBNAIL_TASK_SCRIPT_URL, THUMBNAIL_WIDTH, THUMBNAIL_JPEG_QUALITY } = await import('../dist/server/bootstrap/index.js');
  assert.deepEqual(readPdfitTaskSchedulerEnvironment({}), { intervalMs: 3_600_000, concurrency: 2, initialDelayMs: 30_000, cooldownMs: 0 });
  assert.deepEqual(readPdfitTaskSchedulerEnvironment({ PDFIT_TASK_INTERVAL_MINUTES: '15', PDFIT_TASK_CONCURRENCY: '4', PDFIT_TASK_INITIAL_DELAY_SECONDS: '0', PDFIT_TASK_COOLDOWN_MS: '250' }), { intervalMs: 900_000, concurrency: 4, initialDelayMs: 0, cooldownMs: 250 });
  assert.throws(() => readPdfitTaskSchedulerEnvironment({ PDFIT_TASK_CONCURRENCY: '0' }), /PDFIT_TASK_CONCURRENCY must be an integer between 1 and 16/);

  // Stand-in for a storage API: bearer token required, byte ranges honoured.
  const pdf = Buffer.concat([buildPdf({ label: 'remote', rgb: [0.9, 0.5, 0.1] }), Buffer.alloc(600 * 1024, 0x20)]);
  const seen = [];
  const app = express();
  app.get('/files/:id', (request, response) => {
    seen.push({ authorization: request.get('authorization') ?? null, range: request.get('range') ?? null });
    if (request.get('authorization') !== 'Bearer account-token') { response.status(401).end(); return; }
    const match = /^bytes=(\d+)-(\d*)$/.exec(request.get('range') ?? '');
    response.setHeader('Accept-Ranges', 'bytes');
    response.type('application/pdf');
    if (!match) { response.setHeader('Content-Length', String(pdf.length)); response.end(pdf); return; }
    const start = Number(match[1]);
    const end = Math.min(match[2] ? Number(match[2]) : pdf.length - 1, pdf.length - 1);
    response.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${pdf.length}`);
    response.setHeader('Content-Length', String(end - start + 1));
    response.end(pdf.subarray(start, end + 1));
  });
  const server = app.listen(0);
  await once(server, 'listening');
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfit-remote-thumbnail-'));
  const scheduler = createPdfitTaskScheduler({ concurrency: 2, logLabel: 'test-tasks' });
  const outcomes = new Map();
  // A hosted job is just another definition on the same scheduler: its own plan, the shared script.
  scheduler.register({
    type: 'remote-thumbnail',
    script: THUMBNAIL_TASK_SCRIPT_URL,
    plan: async () => [['granted', 'Bearer account-token'], ['denied', 'Bearer wrong']].map(([key, authorization]) => ({
      key,
      payload: { source: { kind: 'http', url: `http://127.0.0.1:${server.address().port}/files/${key}`, headers: { Authorization: authorization } }, outputPath: path.join(output, `${key}.jpg`), width: THUMBNAIL_WIDTH, quality: THUMBNAIL_JPEG_QUALITY },
    })),
    onSettled: (task, outcome) => { outcomes.set(task.key, outcome); },
  });
  try {
    await scheduler.planNow();
    await scheduler.whenIdle();
    assert.equal(outcomes.get('granted').ok, true);
    assert.deepEqual([outcomes.get('granted').result.width, outcomes.get('granted').result.height], [360, 480]);
    const image = await loadImage(path.join(output, 'granted.jpg'));
    assert.deepEqual([image.width, image.height], [360, 480]);
    assert.equal(outcomes.get('denied').ok, false, 'a rejected token fails the task instead of producing an image');
    assert.equal(fs.existsSync(path.join(output, 'denied.jpg')), false);
    assert.ok(seen.length >= 2 && seen.every((request) => request.authorization !== null), 'every request to the storage API carries the task headers');
    assert.ok(seen.some((request) => request.authorization === 'Bearer account-token' && request.range !== null), 'the PDF is read in byte ranges, not as one download');
  } finally {
    await scheduler.stop();
    server.close();
    await once(server, 'close');
    fs.rmSync(output, { recursive: true, force: true });
  }
});

test('prepare() finalises the payload at dispatch time and its failure settles the task', async () => {
  const runner = manualRunner(1);
  const received = [];
  const run = runner.run.bind(runner);
  runner.run = (task) => { received.push(task.payload); return run(task); };
  const settled = [];
  let releasePrepare;
  const scheduler = new TaskScheduler({ intervalMs: 3_600_000, concurrency: 1, runner });
  scheduler.register({
    type: 'demo', script: sampleScript,
    plan: async () => ['1', '2', '3'].map((key) => ({ key, payload: { planned: key } })),
    prepare: async (task) => {
      if (task.key === '2') throw new Error('ticket unavailable');
      if (task.key === '1') await new Promise((resolve) => { releasePrepare = resolve; });
      return { ...task.payload, ticket: `fresh-${task.key}` };
    },
    onSettled: (task, outcome) => { settled.push(`${task.key}:${outcome.ok ? 'ok' : outcome.error.name}`); },
  });
  await scheduler.planNow();
  await tick();
  assert.deepEqual(received, [], 'the worker is not started while prepare() is pending');
  assert.equal(scheduler.status().active, 1, 'a preparing task still occupies its one slot');
  releasePrepare();
  await tick();
  assert.deepEqual(received, [{ planned: '1', ticket: 'fresh-1' }]);
  runner.finish('1');
  await tick(); await tick();
  assert.deepEqual(received.at(-1), { planned: '3', ticket: 'fresh-3' }, 'task 2 failed in prepare() and never reached a worker');
  runner.finish('3');
  await scheduler.whenIdle();
  assert.deepEqual(settled, ['1:ok', '2:TaskPrepareError', '3:ok']);
  await scheduler.stop();
});
