import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.PDFIT_TEST_BASE_URL ?? 'http://127.0.0.1:15201';
const browser = await chromium.launch({ headless: true });

try {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 1024, height: 1180 }]) {
    const context = await browser.newContext({ viewport, locale: 'ko-KR' });
    const signIn = await context.request.post(`${baseUrl}/api/auth/local-preview`, { headers: { Origin: baseUrl } });
    assert.equal(signIn.status(), 200);
    const page = await context.newPage();
    await page.goto(`${baseUrl}/folder/PDFit%20Library`, { waitUntil: 'domcontentloaded' });
    const archive = page.getByTestId('lnb-bookmarks');
    await archive.waitFor({ state: 'visible' });
    assert.equal(await archive.getAttribute('aria-label'), '클립');
    assert.equal(await archive.locator('svg').count(), 1);
    assert.equal((await archive.innerText()).includes('클립'), true);
    await archive.click();
    await page.waitForURL('**/bookmarks');
    await page.locator('[data-testid="lnb-bookmarks"].Mui-selected').waitFor({ state: 'visible' });
    assert.equal(await archive.evaluate((element) => element.classList.contains('Mui-selected')), true);
    console.log(JSON.stringify({ viewport, iconVisible: true, visibleLabelShown: true, accessibleLabel: '클립', navigationWorks: true }));
    await context.close();
  }
} finally {
  await browser.close();
}
