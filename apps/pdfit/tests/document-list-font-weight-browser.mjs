import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.PDFIT_TEST_BASE_URL ?? 'http://127.0.0.1:15201';
const outputDir = process.env.PDFIT_TEST_OUTPUT_DIR ?? 'apps/pdfit/tests/reports/document-list-font-weight/20261001_000000';
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const auth = await browser.newContext();
  const signIn = await auth.request.post(`${baseUrl}/api/auth/local-preview`, { headers: { Origin: baseUrl } });
  assert.equal(signIn.status(), 200);
  const foldersResponse = await auth.request.get(`${baseUrl}/api/folders/cache`);
  assert.equal(foldersResponse.status(), 200);
  const folders = await foldersResponse.json();
  const root = folders.snapshot.folders.find((folder) => folder.isRoot && !folder.trashed);
  assert.ok(root, 'root folder not found');
  const storageState = await auth.storageState();
  await auth.close();

  for (const mode of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState });
    await context.addInitScript((colorMode) => localStorage.setItem('pdfit.color-mode', colorMode), mode);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${baseUrl}/folder/${encodeURIComponent(root.name)}`, { waitUntil: 'domcontentloaded' });
    const filename = page.locator('[data-testid="pdf-filename-line"] a').first();
    await filename.waitFor({ state: 'visible', timeout: 30_000 });
    const style = await filename.evaluate((element) => {
      const computed = getComputedStyle(element);
      return { family: computed.fontFamily, weight: computed.fontWeight, synthesis: computed.fontSynthesis };
    });
    const sidebarStyle = await page.locator('.pdfit-tag-row .MuiTypography-body2').first().evaluate((element) => {
      const computed = getComputedStyle(element);
      return { family: computed.fontFamily, weight: computed.fontWeight, synthesis: computed.fontSynthesis };
    });
    assert.deepEqual(style, sidebarStyle, `${mode} filename should match the LNB font family, weight and synthesis`);
    assert.equal(errors.length, 0, `${mode} page errors: ${errors.join('; ')}`);
    await page.screenshot({ path: `${outputDir}/${mode}.png`, fullPage: true });
    console.log(JSON.stringify({ mode, style, filename: await filename.innerText(), errors }));
    await page.goto(`${baseUrl}/tag/${encodeURIComponent('소프트웨어')}`, { waitUntil: 'domcontentloaded' });
    const taggedFilename = page.locator('[data-testid="pdf-filename-line"] a').first();
    await taggedFilename.waitFor({ state: 'visible', timeout: 30_000 });
    const taggedStyle = await taggedFilename.evaluate((element) => {
      const computed = getComputedStyle(element);
      return { family: computed.fontFamily, weight: computed.fontWeight, synthesis: computed.fontSynthesis };
    });
    assert.deepEqual(taggedStyle, sidebarStyle, `${mode} tagged filename should match the LNB font`);
    await page.screenshot({ path: `${outputDir}/${mode}-tag.png`, fullPage: true });
    assert.equal(errors.length, 0, `${mode} tag page errors: ${errors.join('; ')}`);
    await context.close();
  }
} finally {
  await browser.close();
}
