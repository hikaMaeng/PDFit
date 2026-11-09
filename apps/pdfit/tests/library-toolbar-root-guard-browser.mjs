import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.PDFIT_TEST_BASE_URL ?? 'http://127.0.0.1:15201';
const outputDir = 'apps/pdfit/tests/reports/library-toolbar-root-guard/20261001_100430';
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const authContext = await browser.newContext();
  const signIn = await authContext.request.post(`${baseUrl}/api/auth/local-preview`, { headers: { Origin: baseUrl } });
  assert.equal(signIn.status(), 200);
  const bootstrapResponse = await authContext.request.get(`${baseUrl}/api/folders/cache`);
  assert.equal(bootstrapResponse.status(), 200);
  const bootstrap = await bootstrapResponse.json();
  const root = bootstrap.snapshot.folders.find((folder) => folder.isRoot && !folder.trashed);
  assert.ok(root);
  bootstrap.snapshot.folders.push({
    driveFolderId: 'browser-test-ordinary-folder', parentFolderId: root.driveFolderId,
    name: '브라우저 테스트 일반 폴더', color: '#3b82f6', isRoot: false, trashed: false,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  const authState = await authContext.storageState();
  await authContext.close();

  for (const mode of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: authState });
    await context.addInitScript((value) => localStorage.setItem('pdfit.color-mode', value), mode);
    const page = await context.newPage();
    await page.route('**/api/folders/cache**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bootstrap) }));
    for (const route of ['folder/PDFit%20Library', 'tag/%EC%9E%90%EA%B8%B0%EA%B3%84%EB%B0%9C']) {
      await page.goto(`${baseUrl}/${route}`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      await page.locator('.pdfit-pdf-row').first().waitFor({ state: 'visible', timeout: 30_000 });
      const colors = await page.evaluate((titleSelector) => ({
        fixed: getComputedStyle(document.querySelector('[data-testid="library-fixed-controls"]')).backgroundColor,
        row: getComputedStyle(document.querySelector('.pdfit-pdf-row')).backgroundColor,
        main: getComputedStyle(document.querySelector('main')).backgroundColor,
        title: getComputedStyle(document.querySelector(titleSelector)).backgroundColor,
        canvas: getComputedStyle(document.body).backgroundColor,
      }), route.startsWith('folder') ? '[data-testid="folder-title-row"]' : '[data-testid="tag-title-row"]');
      if (mode === 'light') {
        assert.equal(colors.row, 'rgb(255, 255, 255)');
        assert.equal(colors.fixed, colors.row, `${route} fixed controls differ from document rows`);
        assert.equal(colors.main, colors.row, `${route} title and outer gutters are not white`);
      } else {
        assert.equal(colors.fixed, colors.canvas, `${route} dark fixed controls changed`);
        assert.equal(colors.main, colors.canvas, `${route} dark main background changed`);
      }

      const rootRow = page.getByTestId('lnb-folder-row').filter({ hasText: 'PDFit Library' });
      assert.equal(await rootRow.getByTestId('lnb-root-folder-delete-disabled').count(), 0);
      assert.equal(await rootRow.getByTestId('lnb-folder-delete').count(), 0);
      assert.equal(await rootRow.locator('[data-testid="DeleteIcon"]').count(), 0, 'root folder still displays a trash icon');

      const ordinaryRow = page.getByTestId('lnb-folder-row').filter({ hasNotText: 'PDFit Library' }).first();
      assert.ok(await ordinaryRow.count(), 'ordinary folder test fixture is missing');
      const ordinaryDelete = ordinaryRow.getByTestId('lnb-folder-delete');
      assert.equal(await ordinaryDelete.count(), 1);
      assert.equal(await ordinaryDelete.isEnabled(), true);
      await page.screenshot({ path: `${outputDir}/${mode}-${route.startsWith('folder') ? 'folder' : 'tag'}.png`, fullPage: true });
      console.log(JSON.stringify({ mode, route, colors, rootTrashAbsent: true, ordinaryDeleteEnabled: true }));
    }
    await context.close();
  }
} finally {
  await browser.close();
}
