import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.PDFIT_TEST_BASE_URL ?? 'http://127.0.0.1:15201';
const folderName = `codex-lnb-${Date.now()}`;
const evidenceDir = path.resolve('apps/pdfit/tests/reports/local-folder-create-lnb/shots');
const browser = await chromium.launch({ headless: true });

try {
  await mkdir(evidenceDir, { recursive: true });
  const context = await browser.newContext({ baseURL: baseUrl, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  let releaseCreate;
  const createGate = new Promise((resolve) => { releaseCreate = resolve; });

  await page.route('**/api/folders', async (route) => {
    if (route.request().method() === 'POST') {
      await createGate;
    }
    await route.continue();
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const createFolderButton = page.getByTestId('create-folder-button');
  await createFolderButton.waitFor({ state: 'visible' });
  await createFolderButton.click();
  await page.getByLabel('Folder name').fill(folderName);
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  await page.getByRole('button', { name: 'Creating...' }).waitFor({ state: 'visible' });
  assert.equal(new URL(page.url()).pathname, '/', 'server response 전에 폴더 화면으로 이동했습니다.');

  releaseCreate();
  await page.waitForURL(`**/folder/${encodeURIComponent(folderName)}`);
  await page.getByText(folderName, { exact: true }).first().waitFor({ state: 'visible' });

  const foldersResponse = await page.request.get('/api/folders');
  assert.equal(foldersResponse.ok(), true, `folder list failed: ${foldersResponse.status()}`);
  const folders = await foldersResponse.json();
  assert.equal(folders.some((folder) => folder.name === folderName), true, 'API 폴더 목록에 새 폴더가 없습니다.');

  await page.screenshot({ path: path.join(evidenceDir, 'lnb-after-create.png'), fullPage: true });
  await context.close();
  console.log(`local folder LNB synchronization passed: ${folderName}`);
} finally {
  await fetch(`${baseUrl}/api/folders/${encodeURIComponent(folderName)}`, { method: 'DELETE' }).catch(() => undefined);
  await browser.close();
}
