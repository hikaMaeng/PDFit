import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createPageNumberPdf } from './acceptance/lib/pdf-fixtures.mjs';

const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const output = resolve(process.env.PDFIT_TEST_ARTIFACT_DIR ?? 'test/20261124/untagged-upload');
const folder = `codex-upload-index-${randomUUID()}`;
const title = '업로드 등록 검증';
const filename = title + '.pdf';
const folderRoute = '/folder/' + encodeURIComponent(folder);
const folderApi = origin + '/api/folders/' + encodeURIComponent(folder);
const uploadApi = folderApi + '/files';
const uploadHeld = Promise.withResolvers();
const releaseUpload = Promise.withResolvers();
const summaryHeld = Promise.withResolvers();
const releaseSummary = Promise.withResolvers();
const result = { status: 'FAIL', origin, folder, filename, consoleErrors: [], pageErrors: [], requests: {} };
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true, channel: process.env.PDFIT_TEST_CHANNEL || undefined });
let fixtureCreated = false;
try {
  const pdf = await createPageNumberPdf(browser, 1, title);
  const create = await fetch(origin + '/api/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: folder }),
  });
  fixtureCreated = create.ok;
  assert.equal(create.status, 200);

  const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (error) => result.pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') result.consoleErrors.push(message.text());
  });
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/api/tags/')) result.requests[pathname] = (result.requests[pathname] ?? 0) + 1;
  });
  await page.route(origin + '/api/tags/summary', async (route) => {
    summaryHeld.resolve();
    await releaseSummary.promise;
    await route.continue();
  });
  await page.route(uploadApi, async (route) => {
    if (route.request().method() === 'POST') {
      uploadHeld.resolve();
      await releaseUpload.promise;
    }
    await route.continue();
  });

  await page.goto(origin + folderRoute, { waitUntil: 'domcontentloaded' });
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('upload-pdf').click();
  await (await chooser).setFiles({ name: filename, mimeType: 'application/pdf', buffer: pdf });
  await Promise.race([Promise.all([uploadHeld.promise, summaryHeld.promise]), new Promise((_, reject) => {
    const signal = AbortSignal.timeout(8000);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  })]);
  const sidebar = page.getByTestId('lnb-untagged');
  await sidebar.click();
  await page.waitForURL('**/untagged');
  await page.getByTestId('untagged-title').waitFor({ state: 'visible' });
  const main = page.getByRole('main');
  const row = main.getByTestId('pdf-filename-line').filter({ hasText: title });
  assert.equal(await row.count(), 0);
  assert.equal(await main.getByRole('progressbar').count(), 0);
  const countBefore = Number(await page.getByTestId('lnb-untagged-count').innerText());
  await page.screenshot({ path: resolve(output, 'before-commit.png') });

  const uploadResponse = page.waitForResponse((response) => response.url() === uploadApi && response.request().method() === 'POST');
  releaseUpload.resolve();
  const completed = await uploadResponse;
  assert.equal(completed.status(), 200);
  const [book] = await completed.json();
  const { name, size, modifiedAt } = book;
  assert.equal(name, filename);
  assert.equal(size, pdf.length);
  assert.ok(Number.isFinite(Date.parse(modifiedAt)));
  const listAfter = await fetch(origin + '/api/tags/untagged-books');
  assert.equal(listAfter.status, 200);
  const persisted = (await listAfter.json()).find((item) => item.folder === folder && item.filename === filename);
  assert.equal(persisted?.size, size);
  assert.deepEqual(persisted.tags, []);
  await row.waitFor({ state: 'visible' });
  await page.getByTestId('lnb-untagged-count').filter({ hasText: new RegExp(`^${countBefore + 1}$`) }).waitFor();
  assert.equal(await main.getByRole('progressbar').count(), 0);
  await page.screenshot({ path: resolve(output, 'after-commit.png') });
  result.upload = { status: completed.status(), ...book };
  result.renderedWhileSummaryHeld = true;
  result.finalUrl = page.url();
  const summaryResponse = page.waitForResponse(origin + '/api/tags/summary');
  releaseSummary.resolve();
  assert.equal((await summaryResponse).status(), 200);
  assert.deepEqual(result.pageErrors, []);
  // Free probes for the Pro resumable route once before falling back to multipart.
  assert.ok(result.consoleErrors.every((message) => /\b404\b/.test(message)), result.consoleErrors.join('\n'));
  result.status = 'PASS';
} finally {
  releaseUpload.resolve();
  releaseSummary.resolve();
  try {
    await browser.close();
  } finally {
    if (fixtureCreated) {
      const cleanup = await fetch(folderApi, { method: 'DELETE' });
      result.cleanup = cleanup.status;
      assert.equal(cleanup.status, 200);
    }
    await writeFile(resolve(output, 'browser.json'), JSON.stringify(result, null, 2));
  }
}
console.log(JSON.stringify(result));
