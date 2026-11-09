import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.PDFIT_TEST_BASE_URL ?? 'http://127.0.0.1:15201';
const outputDir = 'apps/pdfit/tests/reports/tablet-library-layout/20260930_170000';
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const authContext = await browser.newContext();
  const signIn = await authContext.request.post(`${baseUrl}/api/auth/local-preview`, { headers: { Origin: baseUrl } });
  assert.equal(signIn.status(), 200);
  const authState = await authContext.storageState();
  await authContext.close();
  for (const profile of [
    { name: 'desktop', width: 1280, height: 800, isMobile: false, hasTouch: false },
    { name: 'narrow-desktop', width: 810, height: 1080, isMobile: false, hasTouch: false },
    { name: 'tablet', width: 810, height: 1080, isMobile: true, hasTouch: true },
    { name: 'phone', width: 390, height: 844, isMobile: true, hasTouch: true },
  ]) {
    const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, isMobile: profile.isMobile, hasTouch: profile.hasTouch, storageState: authState });
    await context.addInitScript(() => localStorage.setItem('pdfit.color-mode', 'dark'));
    const page = await context.newPage();
    for (const route of ['folder/PDFit%20Library', 'tag/%EC%9E%90%EA%B8%B0%EA%B3%84%EB%B0%9C']) {
      await page.goto(`${baseUrl}/${route}`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      const row = page.locator('.pdfit-pdf-row').first();
      await row.waitFor({ state: 'visible', timeout: 30_000 });
      const layout = await page.evaluate(() => {
        const rect = (selector) => {
          const bounds = document.querySelector(selector)?.getBoundingClientRect();
          return bounds ? { x: bounds.x, y: bounds.y, right: bounds.right, bottom: bounds.bottom, width: bounds.width, height: bounds.height } : null;
        };
        const header = document.querySelector('[data-testid="pdf-list-header"]');
        return {
          headerColumns: getComputedStyle(header).gridTemplateColumns,
          openedHeader: rect('[data-testid="pdf-list-header"] > :nth-child(3)'),
          sizeHeader: rect('[data-testid="pdf-file-size-header"]'),
          row: rect('.pdfit-pdf-row'),
          openedCell: rect('.pdfit-pdf-row [data-testid="pdf-opened-at"]'),
          sizeCell: rect('.pdfit-pdf-row [data-testid="pdf-file-size"]'),
          tagActions: rect('.pdfit-pdf-row [data-testid="pdf-tag-actions"]'),
          viewportWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        };
      });
      if (profile.name === 'desktop' || profile.name === 'tablet') {
        assert.ok(Math.abs(layout.openedHeader.y - layout.sizeHeader.y) < 2, `${profile.name} file-size heading wrapped: ${JSON.stringify(layout)}`);
        assert.ok(Math.abs(layout.openedCell.y - layout.sizeCell.y) < 8, `${profile.name} file-size cell wrapped: ${JSON.stringify(layout)}`);
        assert.ok(layout.tagActions.right <= profile.width + 1, `${profile.name} tag action clipped: ${JSON.stringify(layout)}`);
      } else {
        assert.ok(layout.sizeHeader.y > layout.openedHeader.y + 10, `${profile.name} compact heading unexpectedly changed: ${JSON.stringify(layout)}`);
      }
      assert.ok(layout.scrollWidth <= layout.viewportWidth + 1, `${profile.name} horizontal overflow: ${JSON.stringify(layout)}`);
      await page.screenshot({ path: `${outputDir}/${profile.name}-${route.startsWith('folder') ? 'folder' : 'tag'}.png`, fullPage: true });
      console.log(JSON.stringify({ profile: profile.name, route, layout }, null, 2));
    }
    await context.close();
  }
} finally {
  await browser.close();
}
