import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';

const baseUrl = process.env.PDFIT_TEST_BASE_URL ?? 'http://127.0.0.1:15201';
const outputDir = 'apps/pdfit/tests/reports/tablet-opened-at/20261001';
await mkdir(outputDir, { recursive: true });

const browserName = process.argv.includes('--webkit') ? 'webkit' : 'chromium';
const browser = await (browserName === 'webkit' ? webkit : chromium).launch({ headless: true });
try {
  const auth = await browser.newContext();
  const signIn = await auth.request.post(`${baseUrl}/api/auth/local-preview`, { headers: { Origin: baseUrl } });
  assert.equal(signIn.status(), 200);
  const meResponse = await auth.request.get(`${baseUrl}/api/auth/me`);
  assert.equal(meResponse.status(), 200);
  const me = await meResponse.json();
  assert.ok(me.user?.id);
  const cacheResponse = await auth.request.get(`${baseUrl}/api/folders/cache`);
  assert.equal(cacheResponse.status(), 200);
  const cache = await cacheResponse.json();
  const folders = new Map(cache.snapshot.folders.map((row) => [row.driveFolderId, row.name]));
  const history = Object.fromEntries(cache.snapshot.pdfs.filter((row) => !row.trashed).flatMap((row) => [
    [row.driveFileId, '2026-09-30T07:50:00.000Z'],
    [`${folders.get(row.parentFolderId) ?? ''}\0${row.name}`, '2026-09-30T07:50:00.000Z'],
  ]));
  assert.ok(Object.keys(history).length > 0);
  const storageState = await auth.storageState();
  await auth.close();

  for (const profile of [
    { name: 'tablet', width: 810, isMobile: true, hasTouch: true },
    { name: 'desktop', width: 1280, isMobile: false, hasTouch: false },
  ]) {
    const context = await browser.newContext({ viewport: { width: profile.width, height: 900 }, isMobile: profile.isMobile, hasTouch: profile.hasTouch, timezoneId: 'Asia/Seoul', locale: 'ko-KR', storageState });
    await context.addInitScript(({ userId, history }) => {
      localStorage.setItem(`pdfit.opened-at.v1.${encodeURIComponent(userId)}`, JSON.stringify(history));
    }, { userId: me.user.id, history });
    const page = await context.newPage();
    for (const route of ['folder/PDFit%20Library', 'tag/%ED%94%84%EB%A1%9C%EA%B7%B8%EB%9E%98%EB%B0%8D']) {
      await page.goto(`${baseUrl}/${route}`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      const populated = page.locator('[data-testid="pdf-opened-at"][datetime]').first();
      await populated.waitFor({ state: 'visible', timeout: 30_000 });
      assert.ok(await populated.getAttribute('datetime'));
      if (profile.name === 'tablet') {
        const date = populated.getByTestId('pdf-opened-date');
        const time = populated.getByTestId('pdf-opened-time');
        assert.match(await date.innerText(), /2026.*09.*30/);
        assert.match(await time.innerText(), /오후.*4:50/);
        const dateBox = await date.boundingBox();
        const timeBox = await time.boundingBox();
        assert.ok(dateBox && timeBox && timeBox.y >= dateBox.y + dateBox.height - 1, 'time must be on a separate line below date');
        assert.ok(dateBox.height < 22 && timeBox.height < 22, 'each tablet label must stay on one line');
      } else {
        assert.equal(await populated.getByTestId('pdf-opened-date').count(), 0, 'desktop must keep its original one-line layout');
        assert.match(await populated.innerText(), /2026.*09.*30.*오후.*4:50/);
      }
      await page.screenshot({ path: `${outputDir}/${browserName}-${profile.name}-${route.startsWith('folder') ? 'folder' : 'tag'}.png`, fullPage: true });
      if (profile.name === 'tablet' && route.startsWith('folder')) {
        const main = page.locator('main');
        await main.evaluate((element) => { element.scrollTop = element.scrollHeight; });
        const menuButton = page.getByRole('button', { name: /메뉴/ }).first();
        const menuBounds = await menuButton.boundingBox();
        assert.ok(menuBounds && menuBounds.y >= 0 && menuBounds.y < 80, 'tablet folder menu button must remain visible while scrolling');
        await menuButton.click();
        await page.locator('.MuiDrawer-paper').first().waitFor({ state: 'visible' });
        await page.keyboard.press('Escape');
        await main.evaluate((element) => { element.scrollTop = 0; });
        await page.locator('button[value="covers"]').click();
        const coverLink = page.locator('[data-testid="pdf-cover-card"] a').first();
        const coverHref = await coverLink.getAttribute('href');
        assert.ok(coverHref?.startsWith('/viewer/'), `cover must navigate through PDFit viewer, got ${coverHref}`);
        await page.locator('button[value="list"]').click();
      }
      console.log(JSON.stringify({ profile: profile.name, route, text: await populated.innerText() }));
    }
    await context.close();
  }
} finally {
  await browser.close();
}
