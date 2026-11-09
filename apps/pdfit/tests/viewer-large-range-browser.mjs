import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.PDFIT_TEST_BASE_URL ?? 'http://127.0.0.1:15201';
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 810, height: 1080 }, isMobile: true, hasTouch: true });
  const signIn = await context.request.post(`${baseUrl}/api/auth/local-preview`, { headers: { Origin: baseUrl } });
  assert.equal(signIn.status(), 200);
  const cache = await (await context.request.get(`${baseUrl}/api/folders/cache`)).json();
  const folders = new Map(cache.snapshot.folders.filter((row) => !row.trashed).map((row) => [row.driveFolderId, row.name]));
  const target = cache.snapshot.pdfs.filter((row) => !row.trashed && folders.has(row.parentFolderId) && row.size > 20 * 1024 * 1024).sort((left, right) => left.size - right.size)[0];
  assert.ok(target, 'a PDF larger than 20 MiB must exist');
  const page = await context.newPage();
  const url = `${baseUrl}/viewer/${encodeURIComponent(folders.get(target.parentFolderId))}/${encodeURIComponent(target.name)}?driveFileId=${encodeURIComponent(target.driveFileId)}`;
  const requests = [];
  page.on('response', (response) => {
    if (response.url().includes(`/api/folders/by-id/${target.driveFileId}`)) requests.push({ method: response.request().method(), status: response.status(), range: response.request().headers().range ?? null });
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForResponse((response) => response.url().includes(`/api/folders/by-id/${target.driveFileId}`) && response.request().headers().range != null, { timeout: 90_000 });
  assert.ok(requests.some((request) => request.method === 'HEAD' && request.status === 200));
  assert.ok(requests.some((request) => request.range !== null && request.status === 206));
  console.log(JSON.stringify({ target: target.name, size: target.size, requests }, null, 2));
} finally {
  await browser.close();
}
