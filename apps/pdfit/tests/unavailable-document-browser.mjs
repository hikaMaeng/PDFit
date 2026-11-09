import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.PDFIT_TEST_BASE_URL ?? 'http://127.0.0.1:15201';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
let refreshRequests = 0;

try {
  const signIn = await context.request.post(`${baseUrl}/api/auth/local-preview`, { headers: { Origin: baseUrl } });
  assert.equal(signIn.status(), 200);
  const cacheResponse = await context.request.get(`${baseUrl}/api/folders/cache`);
  assert.equal(cacheResponse.status(), 200);
  const cache = await cacheResponse.json();
  const folders = new Map(cache.snapshot.folders.filter((folder) => !folder.trashed).map((folder) => [folder.driveFolderId, folder.name]));
  const document = cache.snapshot.pdfs.find((file) => !file.trashed && folders.has(file.parentFolderId) && file.driveFileId);
  assert.ok(document);

  await page.route('**/api/folders/refresh', async (route) => {
    refreshRequests += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mode: 'delta', folders: [], folderDeletes: [], fileDeletes: [], folderUpserts: [], fileUpserts: [] }) });
  });
  await page.route('**/api/folders/by-id/*', async (route) => {
    if (!new URL(route.request().url()).pathname.endsWith(`/${encodeURIComponent(document.driveFileId)}`)) return route.continue();
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not found' }) });
  });

  const viewerUrl = `${baseUrl}/viewer/${encodeURIComponent(folders.get(document.parentFolderId))}/${encodeURIComponent(document.name)}?driveFileId=${encodeURIComponent(document.driveFileId)}`;
  await page.goto(viewerUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText('문서를 열 수 없습니다. 문서나 상위 폴더가 휴지통에 있을 수 있습니다. 서재 목록을 갱신하고 있습니다.').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(() => !document.body.innerText.includes('ResponseException'));
  await page.waitForTimeout(300);
  assert.ok(refreshRequests >= 1, 'missing document should request a library refresh');
  console.log(JSON.stringify({ friendlyError: true, refreshRequests, driveFileId: '[mocked]' }, null, 2));
} finally {
  await browser.close();
}
