import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.PDFIT_TEST_BASE_URL ?? 'http://127.0.0.1:15201';
const outputDir = 'apps/pdfit/tests/reports/folder-rename-font/20261001_101348';
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const auth = await browser.newContext();
  const signIn = await auth.request.post(`${baseUrl}/api/auth/local-preview`, { headers: { Origin: baseUrl } });
  assert.equal(signIn.status(), 200);
  const bootstrapResponse = await auth.request.get(`${baseUrl}/api/folders/cache`);
  assert.equal(bootstrapResponse.status(), 200);
  const bootstrap = await bootstrapResponse.json();
  const root = bootstrap.snapshot.folders.find((folder) => folder.isRoot && !folder.trashed);
  assert.ok(root);
  const ordinaryFolder = bootstrap.snapshot.folders.find((folder) => !folder.isRoot && !folder.trashed);
  assert.ok(ordinaryFolder);
  const ordinaryName = ordinaryFolder.name;
  const authState = await auth.storageState();
  await auth.close();

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: authState });
  await context.addInitScript(() => localStorage.setItem('pdfit.color-mode', 'light'));
  const page = await context.newPage();
  const patchCalls = [];
  await page.route('**/api/folders/cache**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bootstrap) }));
  await page.route('**/api/folders/*', async (route) => {
    if (route.request().method() !== 'PATCH' || route.request().url().endsWith('/color')) return route.continue();
    const oldName = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1));
    const { newName } = route.request().postDataJSON();
    const folder = bootstrap.snapshot.folders.find((item) => item.name === oldName);
    assert.ok(folder, `unknown folder: ${oldName}`);
    patchCalls.push({ oldName, newName, isRoot: folder.isRoot });
    folder.name = newName;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      name: newName, pdfCount: 0, createdAt: folder.createdAt, isRoot: folder.isRoot,
      color: folder.color, driveFolderId: folder.driveFolderId, parentFolderId: folder.parentFolderId,
    }) });
  });

  await page.goto(`${baseUrl}/folder/${encodeURIComponent(root.name)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await page.locator('.pdfit-pdf-row').first().waitFor({ state: 'visible', timeout: 30_000 });
  const rootRow = page.getByTestId('lnb-folder-row').filter({ hasText: root.name });
  assert.equal(await rootRow.getByTestId('lnb-folder-rename').count(), 1);
  assert.equal(await rootRow.getByTestId('lnb-folder-delete').count(), 0);
  const textStyle = await page.locator('[data-testid="pdf-filename-line"] a').first().evaluate((element) => ({ font: getComputedStyle(element).fontFamily, weight: getComputedStyle(element).fontWeight }));
  const sidebarStyle = await page.locator('.pdfit-tag-row .MuiTypography-body2').first().evaluate((element) => ({ font: getComputedStyle(element).fontFamily, weight: getComputedStyle(element).fontWeight }));
  assert.deepEqual(textStyle, sidebarStyle, 'filename should use the LNB font family and weight');
  const columns = await page.getByTestId('pdf-list-header').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').map(Number.parseFloat));
  assert.ok(columns[1] / columns[2] >= 2.7, `filename column was not widened: ${columns}`);
  await page.screenshot({ path: `${outputDir}/before-rename.png`, fullPage: true });

  await rootRow.getByTestId('lnb-folder-rename').click();
  await page.getByTestId('rename-folder-input').locator('input').fill('내 문서함 브라우저 테스트');
  await page.getByTestId('rename-folder-save').click();
  await page.waitForURL(`**/folder/${encodeURIComponent('내 문서함 브라우저 테스트')}`);
  await page.getByTestId('folder-title-row').getByText('내 문서함 브라우저 테스트').waitFor();
  const renamedRoot = page.getByTestId('lnb-folder-row').filter({ hasText: '내 문서함 브라우저 테스트' });
  assert.equal(await renamedRoot.getByTestId('lnb-folder-rename').count(), 1);
  assert.equal(await renamedRoot.getByTestId('lnb-folder-delete').count(), 0);
  assert.deepEqual(patchCalls[0], { oldName: 'PDFit Library', newName: '내 문서함 브라우저 테스트', isRoot: true });

  const ordinary = page.getByTestId('lnb-folder-row').filter({ hasText: ordinaryName });
  assert.equal(await ordinary.getByTestId('lnb-folder-rename').count(), 1);
  assert.equal(await ordinary.getByTestId('lnb-folder-delete').count(), 1);
  await ordinary.getByTestId('lnb-folder-rename').click();
  await page.getByTestId('rename-folder-input').locator('input').fill('일반 폴더 이름 변경');
  await page.getByTestId('rename-folder-save').click();
  await page.getByTestId('lnb-folder-row').filter({ hasText: '일반 폴더 이름 변경' }).waitFor();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.deepEqual(patchCalls[1], { oldName: ordinaryName, newName: '일반 폴더 이름 변경', isRoot: false });
  await page.screenshot({ path: `${outputDir}/after-rename.png`, fullPage: true });
  console.log(JSON.stringify({ textStyle, columns, patchCalls, rootDeleteAbsent: true, ordinaryDeletePresent: true }));
  await context.close();
} finally {
  await browser.close();
}
