import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15201';
const now = new Date().toISOString();
const browser = await chromium.launch({ headless: true });
const json = (route, value) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
let assigned = false;
let folderName = 'PDFit Library';
let snapshotReads = 0;

const attach = async (page) => {
  await page.addInitScript(() => {
    localStorage.setItem('pdfit.language', 'ko');
    localStorage.setItem('pdfit.library.view', 'list');
  });
  await page.route(`${origin}/api/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') return json(route, { authenticated: true, user: { id: 'same-account', email: 'same@example.invalid', name: 'Same Account', picture: null }, subscription: { status: 'active', access: true, priceKrw: 12000, trialEndsAt: now, currentPeriodEndsAt: '2027-10-02T00:00:00.000Z', cancelAtPeriodEnd: false, nextBillingAt: null, trialDaysRemaining: 0, earlyPurchaseBonusDays: 0 } });
    if (path === '/api/folders/cache') {
      snapshotReads += 1;
      return json(route, { libraryInstanceId: 'same-library', schemaVersion: '1', hydratedAt: new Date().toISOString(), snapshot: {
        system: [], folders: [{ driveFolderId: 'folder-1', parentFolderId: 'root', name: folderName, color: '#3b82f6', isRoot: true, trashed: false, createdAt: now, updatedAt: now }],
        pdfs: [{ driveFileId: 'file-1', parentFolderId: 'folder-1', name: '동기화 문서.pdf', mimeType: 'application/pdf', size: 1024, createdTime: now, modifiedTime: now, trashed: false, updatedAt: now }],
        tags: assigned ? [{ tagId: 'tag-1', name: '소프트웨어', color: '#22c55e', createdAt: now, updatedAt: now, deletedAt: '' }] : [],
        pdf_tags: assigned ? [{ relationId: 'relation-1', driveFileId: 'file-1', tagId: 'tag-1', createdAt: now, updatedAt: now, deletedAt: '' }] : [],
        bookmarks: [], reading_progress: [], viewer_state: [], sync_state: [],
      } });
    }
    if (path === '/api/tags/folder/PDFit%20Library/auto' && route.request().method() === 'POST') {
      assigned = true;
      return json(route, { processed: 1, failed: 0, addedTags: 1, books: [{ filename: '동기화 문서.pdf', driveFileId: 'file-1', assignedTag: '소프트웨어', addedTags: ['소프트웨어'], removedTags: [] }], errors: [] });
    }
    if (path === '/api/tags' && route.request().method() === 'DELETE') {
      assigned = false;
      return json(route, { ok: true });
    }
    if (path === '/api/tags/summary') return json(route, assigned ? [{ name: '소프트웨어', bookCount: 1, color: '#22c55e' }] : []);
    if (path === '/api/folders') return json(route, [{ name: folderName, pdfCount: 1, isRoot: true, color: '#3b82f6' }]);
    if (path === '/api/bookmarks') return json(route, []);
    if (path === '/api/settings/translations') return json(route, { translations: [] });
    if (path === '/api/events') return route.fulfill({ status: 204 });
    return json(route, []);
  });
};

try {
  const tablet = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1024, height: 768 }, hasTouch: true });
  const pc = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1280, height: 800 } });
  const tabletPage = await tablet.newPage();
  const pcPage = await pc.newPage();
  await attach(tabletPage);
  await attach(pcPage);
  const path = `${origin}/folder/PDFit%20Library`;
  await Promise.all([tabletPage.goto(path), pcPage.goto(path)]);
  const tabletRow = tabletPage.locator('.pdfit-pdf-row').filter({ hasText: '동기화 문서.pdf' });
  const pcRow = pcPage.locator('.pdfit-pdf-row').filter({ hasText: '동기화 문서.pdf' });
  await Promise.all([tabletRow.waitFor(), pcRow.waitFor()]);
  assert.equal((await pcRow.getByTestId('pdf-tag-values').innerText()).trim(), '');

  await tabletPage.getByTestId('ai-auto-tag-all').click();
  await tabletPage.getByRole('dialog').locator('button').last().click();
  await tabletRow.getByTestId('pdf-tag-values').getByText('소프트웨어').waitFor();
  const beforeFocus = snapshotReads;
  await pcPage.evaluate(() => window.dispatchEvent(new Event('focus')));
  await pcRow.getByTestId('pdf-tag-values').getByText('소프트웨어').waitFor();
  assert.ok(snapshotReads > beforeFocus, 'PC must fetch the remote snapshot after returning to the tab');

  await tabletPage.getByRole('button', { name: '태그 전체 초기화' }).click();
  await tabletPage.getByRole('dialog').getByRole('button', { name: '삭제' }).click();
  await tabletRow.getByTestId('pdf-tag-values').getByText('소프트웨어').waitFor({ state: 'hidden' });
  await pcPage.evaluate(() => window.dispatchEvent(new Event('focus')));
  await pcRow.getByTestId('pdf-tag-values').getByText('소프트웨어').waitFor({ state: 'hidden' });

  folderName = '내 문서함';
  await pcPage.evaluate(() => window.dispatchEvent(new Event('focus')));
  await pcPage.locator('.MuiDrawer-paper').getByText('내 문서함').waitFor();
  await pcPage.goto(origin);
  await pcPage.getByRole('main').getByText('v0.4.4', { exact: true }).waitFor();
  assert.equal(await pcPage.getByText('PDFIT 독서 작업 공간', { exact: true }).count(), 0);
  console.log(`PASS same account: AI tag, tag reset, and folder rename reached PC after focus (${snapshotReads} snapshots)`);
} finally {
  await browser.close();
}
