import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';

const baseUrl = process.env.PDFIT_TEST_BASE_URL ?? 'http://127.0.0.1:15201';
const outputDir = 'apps/pdfit/tests/reports/tablet-viewer-loading/20261001';
const targetName = process.argv.find((argument) => argument.startsWith('--file='))?.slice('--file='.length) ?? '코어 코틀린.pdf';
await mkdir(outputDir, { recursive: true });

const browser = await (process.argv.includes('--webkit') ? webkit : chromium).launch({ headless: true });
try {
  const bootstrapContext = await browser.newContext();
  const signIn = await bootstrapContext.request.post(`${baseUrl}/api/auth/local-preview`, { headers: { Origin: baseUrl } });
  assert.equal(signIn.status(), 200);
  const cacheResponse = await bootstrapContext.request.get(`${baseUrl}/api/folders/cache`);
  assert.equal(cacheResponse.status(), 200);
  const cache = await cacheResponse.json();
  const folders = new Map(cache.snapshot.folders.filter((row) => !row.trashed).map((row) => [row.driveFolderId, row.name]));
  const target = cache.snapshot.pdfs.find((row) => !row.trashed && row.name === targetName && folders.has(row.parentFolderId));
  assert.ok(target, `representative PDF must exist: ${targetName}`);
  const url = `${baseUrl}/viewer/${encodeURIComponent(folders.get(target.parentFolderId))}/${encodeURIComponent(target.name)}?driveFileId=${encodeURIComponent(target.driveFileId)}`;
  const pdfBytes = process.argv.includes('--cached-pdf')
    ? await (await bootstrapContext.request.get(`${baseUrl}/api/folders/by-id/${target.driveFileId}`, { timeout: 90_000 })).body()
    : null;
  const authState = await bootstrapContext.storageState();
  await bootstrapContext.close();

  for (const profile of [
    { name: 'desktop', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    { name: 'tablet', viewport: { width: 810, height: 1080 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  ].filter((item) => !process.argv.includes('--tablet-only') || item.name === 'tablet')) {
    const context = await browser.newContext({ ...profile, storageState: authState });
    const page = await context.newPage();
    if (pdfBytes) {
      await page.route(`**/api/folders/by-id/${target.driveFileId}`, async (route) => {
        if (route.request().method() === 'HEAD') {
          await route.fulfill({ status: 200, headers: { 'content-type': 'application/pdf', 'accept-ranges': 'bytes', 'content-length': String(pdfBytes.length) } });
          return;
        }
        const requested = route.request().headers().range;
        const match = requested?.match(/^bytes=(\d+)-(\d*)$/);
        const start = match ? Number(match[1]) : 0;
        const end = match ? Math.min(pdfBytes.length - 1, match[2] ? Number(match[2]) : pdfBytes.length - 1) : pdfBytes.length - 1;
        await route.fulfill({
          status: match ? 206 : 200,
          headers: { 'content-type': 'application/pdf', 'accept-ranges': 'bytes', 'content-length': String(end - start + 1), ...(match ? { 'content-range': `bytes ${start}-${end}/${pdfBytes.length}` } : {}) },
          body: pdfBytes.subarray(start, end + 1),
        });
      });
    }
    const requests = [];
    const pending = new Map();
    page.on('request', (request) => { if (request.url().includes('/api/folders/by-id/')) pending.set(request, performance.now()); });
    page.on('response', (response) => {
      const start = pending.get(response.request());
      if (start != null) { requests.push({ method: response.request().method(), status: response.status(), ms: Math.round(performance.now() - start), range: response.request().headers()['range'] ?? null }); pending.delete(response.request()); }
    });
    const start = performance.now();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const toolbar = page.getByRole('toolbar', { name: 'viewer controls' });
    await toolbar.waitFor({ state: 'visible', timeout: 90_000 });
    const toolbarAtMs = Math.round(performance.now() - start);
    await page.waitForFunction(() => [...document.querySelectorAll('[data-pdf-page] canvas')].some((canvas) => canvas instanceof HTMLCanvasElement && canvas.width > 0 && canvas.height > 0), undefined, { timeout: 90_000 });
    const firstCanvasAtMs = Math.round(performance.now() - start);
    const annotationRail = page.locator('aside').filter({ has: page.getByTestId('select-move-cursor-icon') });
    await annotationRail.waitFor({ state: 'visible' });
    const annotationRailBefore = await annotationRail.boundingBox();
    const indicator = page.getByTestId('viewer-page-indicator');
    const before = await Promise.all([toolbar.boundingBox(), indicator.boundingBox()]);
    await page.getByRole('button', { name: '연속 스크롤' }).click();
    const scrollArea = page.getByTestId('pdf-scroll-area');
    await scrollArea.waitFor({ state: 'visible', timeout: 30_000 });
    await scrollArea.evaluate((element) => { element.scrollTop = Math.min(element.scrollHeight, Math.max(element.clientHeight, 1200)); });
    await page.waitForTimeout(600);
    const after = await Promise.all([toolbar.boundingBox(), indicator.boundingBox()]);
    const pageNumber = await indicator.locator('input').inputValue();
    const firstCanvas = await page.locator('[data-pdf-page] canvas').first().evaluate((element) => ({ width: element.width, height: element.height })).catch(() => null);
    const annotationRailAfter = await annotationRail.boundingBox();
    const result = { browser: process.argv.includes('--webkit') ? 'webkit' : 'chromium', profile: profile.name, toolbarAtMs, firstCanvasAtMs, pageNumber, toolbarBefore: before[0], toolbarAfter: after[0], annotationRailBefore, annotationRailAfter, indicatorBefore: before[1], indicatorAfter: after[1], viewport: profile.viewport, firstCanvas, requests: requests.slice(0, 12), alerts: await page.getByRole('alert').allTextContents() };
    console.log(JSON.stringify(result, null, 2));
    assert.ok(annotationRailBefore && annotationRailAfter && annotationRailBefore.x < 100 && annotationRailAfter.x < 100, 'annotation sidebar must stay visible on the tablet left edge');
    assert.equal(requests.filter((request) => request.method === 'HEAD' && request.status === 200).length, 1, 'small PDF must use one metadata HEAD');
    if (profile.hasTouch && Number(target.size) > 20 * 1024 * 1024) {
      assert.ok(requests.some((request) => request.method === 'GET' && request.status === 206), 'tablet must load the first page with byte ranges');
      assert.equal(requests.filter((request) => request.method === 'GET' && request.status === 200).length, 0, 'tablet must not wait for the complete PDF');
    } else {
      assert.equal(requests.filter((request) => request.method === 'GET' && request.status === 200).length, 1, 'small PDF must retain one complete download');
      assert.equal(requests.filter((request) => request.status === 206).length, 0, 'small PDF must not use byte ranges');
    }
    await page.screenshot({ path: `${outputDir}/${result.browser}-${profile.name}-after-scroll.png`, fullPage: true });
    await context.close();
  }
} finally {
  await browser.close();
}
