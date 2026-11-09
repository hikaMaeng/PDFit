import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.PDFIT_TEST_BASE_URL ?? 'http://127.0.0.1:15201';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.getByRole('link', { name: '라이브러리 열기' }).click();
  await page.waitForTimeout(2000);
  const link = page.locator('a[href*="/viewer/"]').first();
  const href = await link.getAttribute('href');
  assert.ok(href, 'PDF viewer link must exist');
  const url = new URL(href, baseUrl);
  const [, , encodedFolder, encodedFilename] = url.pathname.split('/');
  const folder = decodeURIComponent(encodedFolder);
  const filename = decodeURIComponent(encodedFilename);
  const target = `pdfit-viewer-${encodeURIComponent(folder)}--${encodeURIComponent(filename)}`;
  await page.evaluate(({ folder, filename, target }) => {
    localStorage.setItem('pdfit.open-viewers.v1', JSON.stringify({
      [`${folder}\u0000${filename}`]: { target, ownerId: 'stale-browser-test' },
    }));
  }, { folder, filename, target });

  const popupPromise = context.waitForEvent('page');
  await link.click();
  const popup = await popupPromise;
  await popup.getByRole('button', { name: 'highlight' }).waitFor({ timeout: 30000 });
  const popupUrl = popup.url();
  const viewerStatusLocator = popup.getByRole('status', { name: 'viewer status' });
  let viewerStatus = await viewerStatusLocator.textContent();
  for (let attempt = 0; attempt < 60 && !/Pages:\s*[1-9]/.test(viewerStatus ?? ''); attempt += 1) {
    await popup.waitForTimeout(500);
    viewerStatus = await viewerStatusLocator.textContent();
  }
  console.log(JSON.stringify({ href, popupUrl, viewerStatus }, null, 2));
  assert.notEqual(popupUrl, 'about:blank', 'stale registry fallback must navigate the popup');
  assert.match(popupUrl, /\/viewer\//, 'popup must navigate to the PDF viewer');
  assert.match(viewerStatus ?? '', /Pages:\s*[1-9]/, 'PDF viewer must load a document with pages');
} finally {
  await browser.close();
}
