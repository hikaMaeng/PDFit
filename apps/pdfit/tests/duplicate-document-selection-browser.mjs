import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15201';
const now = '2026-10-01T00:00:00.000Z';
const pdfs = [
  { id: 'duplicate-a', name: '같은 이름.pdf' },
  { id: 'duplicate-b', name: '같은 이름.pdf' },
  { id: 'another-file', name: '다른 문서.pdf' },
].map(({ id, name }) => ({ driveFileId: id, parentFolderId: 'folder-1', name, mimeType: 'application/pdf', size: 1024, md5Checksum: '', driveVersion: '1', createdTime: now, modifiedTime: now, trashed: false, updatedAt: now }));

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR' });
  await context.addInitScript(() => localStorage.setItem('pdfit.language', 'ko'));
  await context.route(`${origin}/api/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (value) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/api/events') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: ready\n\n' });
    if (path === '/api/auth/me') return json({ authenticated: true, user: { id: 'duplicate-selection-test', email: 'test@example.com', name: 'Test User', picture: null }, subscription: { status: 'active', access: true, priceKrw: 12000, trialEndsAt: now, currentPeriodEndsAt: null, cancelAtPeriodEnd: false, nextBillingAt: null, trialDaysRemaining: 0, earlyPurchaseBonusDays: 0 } });
    if (path === '/api/folders/cache') return json({
      libraryInstanceId: 'duplicate-selection-test', schemaVersion: '1', hydratedAt: now,
      snapshot: {
        system: [],
        folders: [{ driveFolderId: 'folder-1', parentFolderId: 'root', name: 'PDFit Library', color: '#3b82f6', isRoot: true, trashed: false, createdAt: now, updatedAt: now }],
        pdfs,
        tags: [{ tagId: 'tag-1', name: '소프트웨어', color: '#22c55e', createdAt: now, updatedAt: now, deletedAt: '' }],
        pdf_tags: pdfs.map((pdf, index) => ({ relationId: `relation-${index}`, driveFileId: pdf.driveFileId, tagId: 'tag-1', createdAt: now, updatedAt: now, deletedAt: '' })),
        bookmarks: [], reading_progress: [], viewer_state: [], sync_state: [],
      },
    });
    if (path === '/api/settings/translations') return json({ translations: ['PDFit Library'] });
    return json([]);
  });

  const page = await context.newPage();
  for (const path of ['/tag/%EC%86%8C%ED%94%84%ED%8A%B8%EC%9B%A8%EC%96%B4', '/folder/PDFit%20Library']) {
    await page.goto(`${origin}${path}`, { waitUntil: 'domcontentloaded' });
    const rows = page.locator('.pdfit-pdf-row');
    try {
      await rows.nth(2).waitFor({ state: 'visible' });
    } catch (error) {
      console.error(`Rows unavailable at ${path}: ${await page.locator('body').innerText()}`);
      throw error;
    }
    assert.equal(await rows.count(), 3);
    await rows.nth(1).getByTestId('pdf-selection-checkbox').check();
    assert.equal(await rows.nth(0).getByTestId('pdf-selection-checkbox').isChecked(), false);
    assert.equal(await page.getByTestId('selected-document-count').innerText(), '1개 선택됨');
    await rows.nth(2).getByTestId('pdf-selection-checkbox').check();
    assert.equal(await page.getByTestId('selected-document-count').innerText(), '2개 선택됨');
    await rows.nth(0).getByTestId('pdf-selection-checkbox').check();
    assert.equal(await page.getByTestId('selected-document-count').innerText(), '3개 선택됨');
    assert.equal(await rows.locator('input[type="checkbox"]:checked').count(), 3);
    console.log(JSON.stringify({ path, separateSameNameRows: true, checkedRows: 3, displayedCount: 3 }));
  }
  await context.close();
} finally {
  await browser.close();
}
