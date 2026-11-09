import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15201';
const now = new Date().toISOString();
const browser = await chromium.launch({ headless: true });
const json = (route, value) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });

try {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 1024, height: 768 }]) {
    const context = await browser.newContext({ locale: 'ko-KR', viewport, hasTouch: viewport.width === 1024 });
    const page = await context.newPage();
    let assigned = false;
    await page.addInitScript(() => {
      localStorage.setItem('pdfit.language', 'ko');
      localStorage.setItem('pdfit.library.view', 'list');
    });
    await page.route(`${origin}/api/**`, (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/auth/me') return json(route, { authenticated: true, user: { id: `tag-display-${viewport.width}`, email: 'tag@example.invalid', name: 'Tag Test', picture: null }, subscription: { status: 'active', access: true, priceKrw: 12000, trialEndsAt: now, currentPeriodEndsAt: '2027-10-02T00:00:00.000Z', cancelAtPeriodEnd: false, nextBillingAt: null, trialDaysRemaining: 0, earlyPurchaseBonusDays: 0 } });
      if (path === '/api/folders/cache') return json(route, { libraryInstanceId: 'tag-display-test', schemaVersion: '1', hydratedAt: now, snapshot: {
        system: [], folders: [{ driveFolderId: 'folder-1', parentFolderId: 'root', name: 'PDFit Library', color: '#3b82f6', isRoot: true, trashed: false, createdAt: now, updatedAt: now }],
        pdfs: [{ driveFileId: 'file-1', parentFolderId: 'folder-1', name: '샘플 문서.pdf', mimeType: 'application/pdf', size: 1024, modifiedTime: now, createdTime: now, trashed: false, updatedAt: now }],
        tags: [], pdf_tags: [], bookmarks: [], reading_progress: [], viewer_state: [], sync_state: [],
      } });
      if (path === '/api/tags/folder/PDFit%20Library/auto' && route.request().method() === 'POST') {
        assigned = true;
        return json(route, { processed: 1, failed: 0, addedTags: 1, books: [{ filename: '샘플 문서.pdf', driveFileId: 'file-1', assignedTag: '소프트웨어', addedTags: ['소프트웨어'], removedTags: [] }], errors: [] });
      }
      if (path === '/api/samples') return json(route, { enabled: true, items: [{ id: 'sample-1', name: '공용 문서.pdf', size: 2048, modifiedAt: now }] });
      if (path === '/api/tags/summary') return json(route, assigned ? [{ name: '소프트웨어', bookCount: 1, color: '#22c55e' }] : []);
      if (path === '/api/folders') return json(route, [{ name: 'PDFit Library', pdfCount: 1, isRoot: true, color: '#3b82f6' }]);
      if (path === '/api/bookmarks') return json(route, []);
      if (path === '/api/settings/translations') return json(route, { translations: [] });
      return json(route, []);
    });

    try {
      await page.goto(`${origin}/folder/PDFit%20Library`, { waitUntil: 'domcontentloaded' });
      const row = page.locator('.pdfit-pdf-row').filter({ hasText: '샘플 문서.pdf' });
      await row.waitFor();
      assert.equal((await row.getByTestId('pdf-tag-values').innerText()).trim(), '');
      await page.getByTestId('ai-auto-tag-all').click();
      const dialog = page.getByRole('dialog');
      await dialog.getByText('이 폴더에서 태그가 없는 문서 1개를 자동 분류할까요?').waitFor();
      await dialog.locator('button').last().click();
      await row.getByTestId('pdf-tag-values').getByText('소프트웨어').waitFor();
      assert.equal(assigned, true);
      await page.getByRole('button', { name: '표지 보기' }).click();
      await page.getByTestId('pdf-cover-card').getByText('소프트웨어').waitFor();
      await page.goto(`${origin}/samples`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: '공용 문서.pdf' }).waitFor();
      assert.equal(await page.locator('svg[data-testid="PictureAsPdfOutlinedIcon"]').count(), 0);
      console.log(`PASS ${viewport.width}px: AI tag visible in list and covers; shared-library PDF icon absent`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
