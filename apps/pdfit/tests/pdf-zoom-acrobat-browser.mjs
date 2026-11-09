import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15201';
const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<<>>>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n200\n%%EOF');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
page.on('pageerror', (error) => errors.push(`page: ${error.message}`));

const fulfillJson = (route, value) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
await page.route(`${origin}/api/**`, async (route) => {
  const url = route.request().url();
  if (url.includes('/api/auth/me')) {
    await fulfillJson(route, { authenticated: true, user: { id: 'zoom-user', email: 'zoom@example.com', name: 'Zoom User', picture: null }, subscription: { status: 'active', access: true } });
  } else if (url.includes('/api/folders/cache')) {
    await fulfillJson(route, { libraryInstanceId: 'zoom-library', schemaVersion: '1', hydratedAt: new Date().toISOString(), snapshot: { system: [], folders: [{ driveFolderId: 'folder-1', parentFolderId: 'root', name: 'zoom', color: '#3b82f6', isRoot: true, trashed: false }], pdfs: [{ driveFileId: 'file-1', parentFolderId: 'folder-1', name: 'letter.pdf', mimeType: 'application/pdf', size: pdfBytes.length, trashed: false }], tags: [], pdf_tags: [], bookmarks: [], reading_progress: [], viewer_state: [], sync_state: [] } });
  } else if (url.includes('/files/') || url.includes('/by-id/')) {
    await route.fulfill({ status: 200, contentType: 'application/pdf', body: pdfBytes });
  } else if (url.includes('/api/viewer-state/')) {
    await fulfillJson(route, null);
  } else if (url.includes('/api/progress/')) {
    await fulfillJson(route, { page: 1 });
  } else if (url.includes('/api/bookmarks/') || url.includes('/api/annotations')) {
    await fulfillJson(route, []);
  } else if (url.includes('/api/settings/translations')) {
    await fulfillJson(route, { translations: [] });
  } else {
    await fulfillJson(route, {});
  }
});

const dimensions = async () => page.locator('[data-pdf-page] canvas').evaluate((canvas) => {
  const pageRect = canvas.getBoundingClientRect();
  const viewport = canvas.closest('[data-testid="pdf-scroll-area"]');
  return { width: pageRect.width, height: pageRect.height, viewportWidth: viewport?.clientWidth ?? 0, viewportHeight: viewport?.clientHeight ?? 0 };
});

const waitForDimensions = async (predicate, description) => {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const current = await dimensions();
    if (predicate(current)) return current;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(await dimensions())}`);
};

try {
  await page.goto(`${origin}/viewer/zoom/letter.pdf?driveFileId=file-1&engine=legacy`, { waitUntil: 'domcontentloaded' });
  const zoomInput = page.getByLabel('확대/축소 비율');
  await zoomInput.waitFor({ state: 'visible', timeout: 30000 });
  assert.equal(await zoomInput.evaluate((element) => getComputedStyle(element).textAlign), 'center');
  await page.locator('[data-pdf-page] canvas').waitFor({ state: 'visible', timeout: 30000 });

  assert.equal(await zoomInput.inputValue(), '100');
  const zoom100 = await dimensions();
  assert.deepEqual({ width: zoom100.width, height: zoom100.height }, { width: 816, height: 1056 });

  await zoomInput.fill('125');
  await zoomInput.press('Enter');
  const zoom125 = await waitForDimensions((current) => current.width === 1020, '125% page size');
  assert.deepEqual({ width: zoom125.width, height: zoom125.height }, { width: 1020, height: 1320 });

  await page.getByRole('button', { name: '가로 너비 맞춤' }).click();
  const widthFit = await waitForDimensions((current) => Math.abs(current.width - (current.viewportWidth - 24)) <= 1, 'fit-width page size');
  assert.ok(Math.abs(widthFit.width - (widthFit.viewportWidth - 24)) <= 1);

  await page.getByRole('button', { name: '세로 높이 맞춤' }).click();
  const heightFit = await waitForDimensions((current) => Math.abs(current.height - (current.viewportHeight - 48)) <= 1, 'fit-height page size');
  assert.ok(Math.abs(heightFit.height - (heightFit.viewportHeight - 48)) <= 1);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'PASS', zoom100: { width: 816, height: 1056 }, zoom125: { width: 1020, height: 1320 }, widthFit, heightFit }));
} finally {
  await context.close();
  await browser.close();
}
