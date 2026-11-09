import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.PDFIT_TEST_BASE_URL ?? 'http://127.0.0.1:15201';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

try {
  const signIn = await context.request.post(`${baseUrl}/api/auth/local-preview`, { headers: { Origin: baseUrl } });
  assert.equal(signIn.status(), 200);
  const cacheResponse = await context.request.get(`${baseUrl}/api/folders/cache`);
  assert.equal(cacheResponse.status(), 200);
  const cache = await cacheResponse.json();
  const folders = new Map(cache.snapshot.folders.filter((row) => !row.trashed).map((row) => [row.driveFolderId, row.name]));
  const target = cache.snapshot.pdfs.find((row) => !row.trashed && row.name === '스프링 5 마스터 2e.pdf' && folders.has(row.parentFolderId));
  assert.ok(target, 'screenshot document must exist in the library index');
  const folder = folders.get(target.parentFolderId);
  await page.goto(`${baseUrl}/folder/${encodeURIComponent(folder)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  const row = page.locator('.pdfit-pdf-row').filter({ hasText: target.name }).first();
  await row.waitFor({ state: 'visible' });
  const action = row.getByTestId('pdf-document-info');
  let metadataRequests = 0;
  let metadataResponseStatus = null;
  let metadataRequestAtMs = null;
  let metadataResponseAtMs = null;
  page.on('request', (request) => { if (request.url().includes(`/api/books/${encodeURIComponent(target.driveFileId)}/metadata`)) { metadataRequests += 1; metadataRequestAtMs = performance.now(); } });
  page.on('response', (response) => { if (response.url().includes(`/api/books/${encodeURIComponent(target.driveFileId)}/metadata`)) { metadataResponseStatus = response.status(); metadataResponseAtMs = performance.now(); } });
  const start = performance.now();
  await action.click();
  const dialogAtMs = Math.round(performance.now() - start);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: '제목', exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  const formVisibleAtMs = Math.round(performance.now() - start);
  await dialog.locator('input:not([disabled])').first().waitFor({ state: 'visible', timeout: 30_000 });
  const formReadyAtMs = Math.round(performance.now() - start);
  assert.ok(formReadyAtMs < 500, `document fields should be usable immediately, got ${formReadyAtMs}ms`);
  await dialog.locator('[aria-busy="false"]').waitFor({ state: 'visible', timeout: 30_000 });
  const metadataLoadedAtMs = Math.round(performance.now() - start);
  assert.equal(await dialog.getByRole('button', { name: '문서 항목 직접 입력' }).count(), 0);
  await dialog.getByRole('button', { name: /문서 정보 찾기/ }).waitFor({ state: 'visible' });
  assert.equal(await dialog.getByText('일반 문서 정보입니다.', { exact: false }).count(), 0);
  await dialog.screenshot({ path: 'apps/pdfit/tests/reports/document-metadata-initial-input/dialog-ready.png' });
  await dialog.getByRole('button', { name: '닫기' }).click();
  await dialog.waitFor({ state: 'hidden' });
  const reopenStart = performance.now();
  await action.click();
  await dialog.getByRole('textbox', { name: '제목', exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  await dialog.locator('input:not([disabled])').first().waitFor({ state: 'visible', timeout: 30_000 });
  const reopenReadyAtMs = Math.round(performance.now() - reopenStart);
  assert.equal(metadataResponseStatus, 200);
  assert.equal(metadataRequests, 1, 'reopening the same document should reuse its metadata');

  const racePage = await context.newPage();
  const metadataUrl = `${baseUrl}/api/books/${encodeURIComponent(target.driveFileId)}/metadata`;
  let delayedRequests = 0;
  await racePage.route(metadataUrl, async (route) => {
    delayedRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    await route.continue();
  });
  await racePage.goto(`${baseUrl}/folder/${encodeURIComponent(folder)}`, { waitUntil: 'domcontentloaded' });
  const raceRow = racePage.locator('.pdfit-pdf-row').filter({ hasText: target.name }).first();
  await raceRow.waitFor({ state: 'visible' });
  await raceRow.getByTestId('pdf-document-info').click();
  const raceDialog = racePage.getByRole('dialog');
  const titleField = raceDialog.getByRole('textbox', { name: '제목', exact: true });
  await titleField.fill('로딩 중 작성한 제목');
  await raceDialog.locator('[aria-busy="false"]').waitFor({ state: 'visible', timeout: 30_000 });
  assert.equal(await titleField.inputValue(), '로딩 중 작성한 제목', 'late metadata response must not overwrite an early edit');
  await raceDialog.getByRole('button', { name: '변경사항 저장' }).waitFor({ state: 'visible' });
  assert.equal(await raceDialog.getByRole('button', { name: '변경사항 저장' }).isEnabled(), true);
  assert.equal(delayedRequests, 1);
  console.log(JSON.stringify({ dialogAtMs, formVisibleAtMs, formReadyAtMs, metadataLoadedAtMs, metadataRequestMs: metadataRequestAtMs === null || metadataResponseAtMs === null ? null : Math.round(metadataResponseAtMs - metadataRequestAtMs), reopenReadyAtMs, metadataRequests, delayedRequests, status: metadataResponseStatus, folder }, null, 2));
} finally {
  await browser.close();
}
