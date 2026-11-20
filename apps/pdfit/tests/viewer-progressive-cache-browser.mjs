import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const output = process.env.PDFIT_TEST_OUTPUT ?? 'test/20261120/viewer-progressive-cache';
const viewer = `${origin}/viewer/cache-check/Pages.pdf?engine=gpu&page=3&sample=1&driveFileId=cache-check`;
const pdfUrl = `${origin}/api/samples/cache-check/content`;
const channel = process.env.PDFIT_TEST_CHANNEL ?? 'chrome';
const pageCount = 96;
const targetPage = 80;
const cachedPage = targetPage + 1;

await mkdir(output, { recursive: true });
assert.equal((await fetch(`${origin}/health`)).status, 200);
const browser = await chromium.launch({ channel, args: ['--enable-unsafe-webgpu'] });
const results = { viewer, browser: browser.version(), errors: [] };
const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on('pageerror', (error) => results.errors.push(error.message));

try {
  const fixture = await context.newPage();
  await fixture.setContent(`<style>
    @page { size: Letter; margin: 0 }
    body { margin: 0; print-color-adjust: exact }
    section { box-sizing: border-box; height: 11in; break-after: page; padding: 1in; font: 48px sans-serif }
  </style>${Array.from({ length: pageCount }, (_, index) =>
    `<section style="background: ${index + 1 === cachedPage ? '#409050' : '#4080c0'}">Cache fixture · ${index + 1}</section>`).join('')}`);
  const bytes = await fixture.pdf({ printBackground: true, preferCSSPageSize: true });
  await fixture.close();

  await context.route('**/api/**', (route) => {
    const request = route.request();
    if (request.method() === 'GET' || request.method() === 'HEAD') return route.continue();
    return route.fulfill({ json: { ok: true } });
  });
  await context.route(pdfUrl, (route) => route.fulfill({
    contentType: 'application/pdf',
    headers: { 'content-length': String(bytes.length) },
    body: route.request().method() === 'HEAD' ? undefined : bytes,
  }));
  await context.addInitScript(() => {
    localStorage.setItem('pdfit.language', 'en');
    const trace = window.rasterTrace = [];
    let workerSequence = 0;
    window.Worker = class extends Worker {
      constructor(...args) {
        super(...args);
        this.workerId = ++workerSequence;
        if (!String(args[0]).includes('pdfiumWorkerMain')) return;
        trace.push({ type: 'worker', worker: this.workerId });
        this.addEventListener('message', ({ data }) => {
          if (data?.raster) {
            trace.push({ type: 'reply', kind: data.raster.kind,
              page: data.raster.pageIndex + 1, worker: this.workerId, time: performance.now() });
          }
        });
      }

      postMessage(data, ...args) {
        if (data?.type === 'preview' || data?.type === 'tile') {
          trace.push({ type: data.type, page: data.pageIndex + 1, worker: this.workerId, time: performance.now() });
        }
        super.postMessage(data, ...args);
      }
    };
    document.addEventListener('keydown', ({ key, target }) => {
      if (key === 'Enter' && target.getAttribute?.('aria-label') === 'Page number') {
        trace.push({ type: 'jump', page: Number(target.value), time: performance.now() });
      }
    }, true);
  });

  await page.goto(viewer, { waitUntil: 'domcontentloaded' });
  const status = page.getByRole('status', { name: 'viewer status' });
  await status.filter({ hasText: /Backend: webgpu.*Pages: 3 \/ 96/ }).waitFor({ state: 'attached' });
  const pageInput = page.getByRole('toolbar', { name: 'viewer controls' }).getByLabel('Page number', { exact: true });
  await pageInput.fill(String(targetPage));
  await pageInput.press('Enter');
  await waitForPreview(targetPage);
  await status.filter({ hasText: /Quality: detail.*Pages: 80 \/ 96/ }).waitFor({ state: 'attached' });
  results.targetPixel = await capturePagePixel([64, 128, 192], 'page-80.png');
  await waitForPreview(targetPage - 1);
  await waitForPreview(targetPage + 3);
  await pageInput.fill(String(cachedPage));
  await pageInput.press('Enter');
  await status.filter({ hasText: /Quality: preview.*Pages: 81 \/ 96/ }).waitFor({ state: 'attached' });
  results.cachedPixel = await capturePagePixel([64, 144, 80], 'page-81.png');

  const trace = await page.evaluate(() => window.rasterTrace);
  const request = trace.find(({ type, page }) => type === 'preview' && page === targetPage);
  const reply = trace.find(({ type, page, kind }) => type === 'reply' && page === targetPage && kind === 'preview');
  const tile = trace.find(({ type, page }) => type === 'tile' && page === targetPage);
  const [jump, revisit] = trace.filter(({ type }) => type === 'jump');
  const prefetch = trace.filter(({ type, page, time }) => type === 'preview' && page !== targetPage && time > jump.time && time < revisit.time);

  assert.equal(trace.filter(({ type }) => type === 'worker').length, 4);
  assert.ok(request.time >= jump.time && reply.time < tile.time, 'the jump requests a fresh preview before detail');
  assert.ok(tile.time - jump.time >= 190, 'detail observes the 200 ms debounce');
  assert.deepEqual(prefetch.slice(0, 2).map(({ page }) => page).sort(), [79, 81]);
  assert.ok(prefetch[0].time - jump.time >= 490, 'prefetch observes the 500 ms debounce');
  assert.equal(trace.filter(({ type, page }) => type === 'preview' && page === cachedPage).length, 1, 'cache hit needs no second preview');
  assert.deepEqual(results.errors, []);
  results.timingsMs = {
    previewRequest: request.time - jump.time,
    previewReply: reply.time - jump.time,
    firstDetail: tile.time - jump.time,
    firstPrefetch: prefetch[0].time - jump.time,
  };
  console.log('PASS PDFit WebGPU progressive cache', JSON.stringify(results.timingsMs));
} finally {
  results.trace = await page.evaluate(() => window.rasterTrace).catch(() => []);
  await writeFile(join(output, 'result.json'), JSON.stringify(results, null, 2));
  await browser.close();
}

async function waitForPreview(pageNumber) {
  await page.waitForFunction((number) => window.rasterTrace.some(({ type, page, kind }) =>
    type === 'reply' && page === number && kind === 'preview'), pageNumber);
}

async function capturePagePixel(expected, name) {
  const region = page.getByRole('region', { name: 'PDF viewer', exact: true });
  const bounds = await region.boundingBox();
  assert.ok(bounds);
  const png = await page.screenshot({ clip: {
    x: Math.floor(bounds.x + bounds.width / 2), y: Math.floor(bounds.y + bounds.height / 2), width: 1, height: 1,
  } });
  const actual = [...await sharp(png).removeAlpha().raw().toBuffer()];
  assert.deepEqual(actual, expected);
  await page.screenshot({ path: join(output, name) });
  return actual;
}
