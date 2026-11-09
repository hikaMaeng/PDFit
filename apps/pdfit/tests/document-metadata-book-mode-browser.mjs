import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.PDFIT_TEST_BASE_URL ?? 'http://127.0.0.1:15201';
const outputDir = process.env.PDFIT_TEST_OUTPUT_DIR ?? 'apps/pdfit/tests/reports/document-metadata-book-mode/20261001_000000';
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    localStorage.setItem('pdfit.language', 'ko');
    localStorage.setItem('pdfit.color-mode', 'dark');
  });
  const login = await context.request.post(`${baseUrl}/api/auth/local-preview`, { headers: { Origin: baseUrl } });
  assert.equal(login.status(), 200);
  const cacheResponse = await context.request.get(`${baseUrl}/api/folders/cache`);
  assert.equal(cacheResponse.status(), 200);
  const cache = await cacheResponse.json();
  const folders = new Map(cache.snapshot.folders.filter((item) => !item.trashed).map((item) => [item.driveFolderId, item.name]));
  const target = cache.snapshot.pdfs.find((item) => !item.trashed && item.name === '스프링 5 마스터 2e.pdf' && folders.has(item.parentFolderId));
  assert.ok(target, 'test document not found');

  const page = await context.newPage();
  const errors = [];
  const savedRequests = [];
  let researchRequests = 0;
  let savedMetadata = null;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/books/*/metadata', (route) => {
    if (!route.request().url().includes(encodeURIComponent(target.driveFileId))) return route.continue();
    if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(savedMetadata) });
    if (route.request().method() === 'PUT') {
      savedMetadata = { ...route.request().postDataJSON(), provenance: 'manual', updatedAt: new Date().toISOString() };
      savedRequests.push(savedMetadata);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(savedMetadata) });
    }
    return route.continue();
  });
  await page.route('**/api/books/*/research', (route) => {
    if (!route.request().url().includes(encodeURIComponent(target.driveFileId))) return route.continue();
    researchRequests += 1;
    if (researchRequests === 1) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: '일치하는 도서 없음' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      driveFileId: target.driveFileId, documentType: 'book', title: target.name.replace(/\.pdf$/i, ''), subtitle: '',
      authors: ['테스트 저자'], translator: '', publisher: '', publishedDate: '', isbn: '978-0', language: '',
      subjects: [], description: '', summary: '', tableOfContents: '', coverUrl: '', sources: [], provenance: 'ai', updatedAt: new Date().toISOString(),
    }) });
  });

  const folderUrl = `${baseUrl}/folder/${encodeURIComponent(folders.get(target.parentFolderId))}`;
  await page.goto(folderUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  const open = async () => {
    const row = page.locator('.pdfit-pdf-row').filter({ hasText: target.name }).first();
    await row.getByTestId('pdf-document-info').click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('input:not([disabled])').first().waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(300);
    return dialog;
  };

  let dialog = await open();
  for (const label of ['작성자', '작성 기관', '작성일', '언어']) {
    assert.equal(await dialog.getByRole('textbox', { name: label, exact: true }).count(), 0, `${label} should be hidden`);
  }
  assert.equal(await dialog.getByRole('button', { name: /항목 직접 입력/ }).count(), 0, 'manual book mode must be absent');
  await dialog.screenshot({ path: `${outputDir}/document.png` });
  const research = dialog.getByRole('button', { name: /문서 정보 찾기/ });
  await research.click();
  await dialog.getByRole('alert').waitFor({ state: 'visible', timeout: 30_000 });
  assert.equal(await dialog.getByRole('textbox', { name: 'ISBN', exact: true }).count(), 0, 'failed lookup must keep document mode');
  await research.click();
  const author = dialog.getByRole('textbox', { name: '저자', exact: true });
  await author.waitFor({ state: 'visible', timeout: 30_000 });
  await dialog.getByRole('textbox', { name: 'ISBN', exact: true }).fill('');
  await dialog.getByRole('button', { name: '변경사항 저장' }).click();
  assert.equal(savedRequests.length, 1);
  assert.equal(savedRequests[0].documentType, 'book');
  assert.deepEqual(savedRequests[0].authors, ['테스트 저자']);
  assert.equal(savedRequests[0].isbn, '');
  await dialog.getByRole('button', { name: '닫기' }).click();
  await dialog.waitFor({ state: 'hidden' });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  dialog = await open();
  assert.equal(await dialog.getByRole('textbox', { name: '저자', exact: true }).inputValue(), '테스트 저자');
  assert.equal(await dialog.getByRole('textbox', { name: 'ISBN', exact: true }).count(), 1);
  await dialog.screenshot({ path: `${outputDir}/book-reopened.png` });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ modeStored: savedMetadata.documentType, authorRestored: true, researchRequests, savedRequests: savedRequests.length, actualServerWrites: 0, errors }));
  await context.close();
} finally {
  await browser.close();
}
