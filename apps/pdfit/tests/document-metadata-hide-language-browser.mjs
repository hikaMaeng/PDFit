import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.PDFIT_TEST_BASE_URL ?? 'http://127.0.0.1:15201';
const outputDir = process.env.PDFIT_TEST_OUTPUT_DIR ?? 'apps/pdfit/tests/reports/document-metadata-hide-language/20261001_000000';
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    localStorage.setItem('pdfit.language', 'ko');
    localStorage.setItem('pdfit.color-mode', 'dark');
  });
  const signIn = await context.request.post(`${baseUrl}/api/auth/local-preview`, { headers: { Origin: baseUrl } });
  assert.equal(signIn.status(), 200);
  const cacheResponse = await context.request.get(`${baseUrl}/api/folders/cache`);
  assert.equal(cacheResponse.status(), 200);
  const cache = await cacheResponse.json();
  const folders = new Map(cache.snapshot.folders.filter((item) => !item.trashed).map((item) => [item.driveFolderId, item.name]));
  const target = cache.snapshot.pdfs.find((item) => !item.trashed && item.name === '스프링 5 마스터 2e.pdf' && folders.has(item.parentFolderId));
  assert.ok(target, 'test document not found');

  const page = await context.newPage();
  const errors = [];
  const writes = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (request.method() === 'PUT' && request.url().includes('/metadata')) writes.push(request.url()); });
  await page.goto(`${baseUrl}/folder/${encodeURIComponent(folders.get(target.parentFolderId))}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  const row = page.locator('.pdfit-pdf-row').filter({ hasText: target.name }).first();
  await row.getByTestId('pdf-document-info').click();
  const dialog = page.getByRole('dialog');
  const title = dialog.getByRole('textbox', { name: '제목', exact: true });
  await title.waitFor({ state: 'visible', timeout: 30_000 });
  await dialog.locator('input:not([disabled])').first().waitFor({ state: 'visible', timeout: 30_000 });
  for (const label of ['작성자', '작성 기관', '작성일', '언어']) {
    assert.equal(await dialog.getByRole('textbox', { name: label, exact: true }).count(), 0, `${label} should be hidden for a personal document`);
  }
  for (const label of ['제목', '부제·보조 제목', '키워드']) {
    assert.equal(await dialog.getByRole('textbox', { name: label, exact: true }).count(), 1, `${label} should remain visible`);
  }
  assert.equal(await dialog.getByRole('button', { name: /항목 직접 입력/ }).count(), 0, 'manual book mode should not be offered');
  assert.equal(await dialog.getByRole('textbox', { name: 'ISBN', exact: true }).count(), 0);
  await dialog.screenshot({ path: `${outputDir}/document.png` });
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, [], 'browser test must not save metadata');
  console.log(JSON.stringify({ personalFieldsHidden: ['작성자', '작성 기관', '작성일', '언어'], manualBookModeAbsent: true, errors, writes }));
  await context.close();
} finally {
  await browser.close();
}
