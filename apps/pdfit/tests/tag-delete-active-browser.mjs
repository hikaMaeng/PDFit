import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15201';
const now = new Date().toISOString();
const singleTag = process.argv.includes('--single');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
let deleted = false;
const json = (route, value) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
await page.route(`${origin}/api/**`, async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/api/auth/me') return json(route, { authenticated: true, user: { id: 'tag-test', email: 'tag@example.com', name: 'Tag Test', picture: null }, subscription: { status: 'active', access: true, priceKrw: 12000, trialEndsAt: now, currentPeriodEndsAt: '2027-10-02T00:00:00.000Z', cancelAtPeriodEnd: false, nextBillingAt: null, trialDaysRemaining: 0, earlyPurchaseBonusDays: 0 } });
  if (path === '/api/folders/cache') return json(route, { libraryInstanceId: 'tag-delete-test', schemaVersion: '1', hydratedAt: now, snapshot: {
    system: [], folders: [{ driveFolderId: 'folder-1', parentFolderId: 'root', name: 'PDFit Library', color: '#3b82f6', isRoot: true, trashed: false }],
    pdfs: [{ driveFileId: 'file-1', parentFolderId: 'folder-1', name: 'sample.pdf', mimeType: 'application/pdf', size: 1024, modifiedTime: now, trashed: false }],
    tags: [{ tagId: 'tag-1', name: 'UI·UX', color: '#22c55e', createdAt: now, updatedAt: now, deletedAt: '' }],
    pdf_tags: [{ relationId: 'relation-1', driveFileId: 'file-1', tagId: 'tag-1', createdAt: now, updatedAt: now, deletedAt: '' }],
    bookmarks: [], reading_progress: [], viewer_state: [], sync_state: [],
  } });
  if (route.request().method() === 'DELETE' && (path === '/api/tags' || path === '/api/tags/UI%C2%B7UX')) { deleted = true; return json(route, { ok: true }); }
  if (path === '/api/tags/summary') return json(route, deleted ? [] : [{ name: 'UI·UX', bookCount: 1, color: '#22c55e' }]);
  if (path === '/api/tags/UI%C2%B7UX/books') return json(route, deleted ? [] : [{ folder: 'PDFit Library', filename: 'sample.pdf', driveFileId: 'file-1', size: 1024, modified_at: now, tags: ['UI·UX'] }]);
  if (path === '/api/folders') return json(route, [{ name: 'PDFit Library', pdfCount: 1, isRoot: true, color: '#3b82f6' }]);
  if (path === '/api/bookmarks') return json(route, []);
  if (path === '/api/settings/translations') return json(route, { translations: [] });
  return json(route, []);
});

try {
  await page.goto(`${origin}/tag/${encodeURIComponent('UI·UX')}`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('tag-title-row').getByText('UI·UX').waitFor();
  if (singleTag) {
    await page.locator('.pdfit-tag-row').hover();
    await page.getByRole('button', { name: '태그 삭제' }).click();
  } else await page.getByRole('button', { name: '태그 전체 초기화' }).click();
  const dialog = page.getByRole('dialog');
  if (!singleTag) await dialog.getByText('모든 문서의 태그 연결 1개를 초기화할까요? 문서와 보관함 항목은 유지됩니다.', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: '삭제' }).click();
  await page.waitForURL(`${origin}/`);
  await page.getByTestId('tag-title-row').waitFor({ state: 'hidden' });
  assert.equal(deleted, true);
  assert.equal(await page.getByTestId('tag-title-row').count(), 0, 'deleted tag page must not remain visible');
  console.log(`PASS deleting ${singleTag ? 'one active tag' : 'every tag'} exits the removed tag page`);
} finally {
  await context.close();
  await browser.close();
}
