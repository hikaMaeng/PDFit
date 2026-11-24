import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { startPointerDrag } from './drag-pointer.mjs';

const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const evidenceDir = process.env.PDFIT_TEST_ARTIFACT_DIR;
const tag = '테스트 태그';
const existing = '기존 태그';
const source = { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: '보내는 폴더', color: null, tags: [tag] };
const target = { id: 'aaaaaaaa-0000-4000-8000-000000000002', name: '받는 폴더', color: null, tags: [] };

if (evidenceDir) await mkdir(evidenceDir, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PDFIT_TEST_CHANNEL ?? 'chrome' });
try {
  for (const scenario of ['empty body', 'member row', 'collapsed title', 'refresh during drop', 'phone touch']) {
    const touch = scenario === 'phone touch';
    const viewport = touch ? { width: 390, height: 844 } : { width: 1440, height: 900 };
    const context = await browser.newContext({ locale: 'ko-KR', viewport, hasTouch: touch, isMobile: touch, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const refreshDuringDrop = scenario === 'refresh during drop';
    const sendRefresh = Promise.withResolvers();
    const finishWrite = Promise.withResolvers();
    const folders = [structuredClone(source), { ...target, tags: scenario === 'member row' ? [existing] : [] }];
    const membershipPath = `/api/tag-folders/${encodeURIComponent(target.name)}/tags/${encodeURIComponent(tag)}`;
    await page.route('**/api/folders/cache', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/tags/summary', (route) => route.fulfill({ json: [tag, existing].map((name) => ({ name, bookCount: 1, color: '#22c55e' })) }));
    if (refreshDuringDrop) {
      await page.route('**/api/events', async (route) => {
        await sendRefresh.promise;
        await route.fulfill({ contentType: 'text/event-stream', body: 'data: tag-folders-changed\n\n' });
      });
    }
    await page.route(/\/api\/tag-folders(?:\/.*)?$/, async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() === 'GET' && path === '/api/tag-folders') return route.fulfill({ json: folders });
      if (request.method() !== 'PUT' || path !== membershipPath) return route.fulfill({ status: 400, json: { error: 'Unexpected folder write' } });
      if (refreshDuringDrop) await finishWrite.promise;
      folders[1].tags.push(tag);
      return route.fulfill({ json: { ok: true } });
    });
    try {
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      const openDrawer = () => page.getByRole('button', { name: '메뉴 열기', exact: true }).tap();
      if (touch) await openDrawer();
      const folderRow = (name) => page.getByTestId('lnb-tag-folder').filter({ has: page.getByRole('button', { name, exact: true }) });
      const sourceFolder = folderRow(source.name);
      const targetFolder = folderRow(target.name);
      const toggle = targetFolder.getByRole('button', { name: target.name, exact: true });
      const sourceTag = sourceFolder.getByText(tag, { exact: true });
      let drop = toggle;
      if (scenario === 'empty body' || refreshDuringDrop) drop = targetFolder.getByText('태그를 끌어다 놓으세요.', { exact: true });
      if (scenario === 'member row') drop = targetFolder.getByText(existing, { exact: true });
      if (scenario === 'collapsed title') await toggle.click();
      const [response] = await Promise.all([
        page.waitForResponse((response) => new URL(response.url()).pathname === membershipPath && response.request().method() === 'PUT', { timeout: 5000 }),
        (async () => {
          if (touch) {
            const grip = sourceFolder.getByRole('img', { name: `${tag} 태그를 폴더로 드래그`, exact: true });
            const pointer = await startPointerDrag(page, grip, { touch });
            await pointer.over(drop);
            if (evidenceDir) await page.screenshot({ path: join(evidenceDir, 'folder-phone-touch-drag.png') });
            await pointer.drop();
          } else {
            await sourceTag.dragTo(drop, { steps: 12, timeout: 5000 });
          }
          if (!refreshDuringDrop) return;
          const refresh = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/tag-folders' && response.request().method() === 'GET', { timeout: 4000 });
          sendRefresh.resolve();
          await (await refresh).finished();
          finishWrite.resolve();
        })(),
      ]);
      assert.equal(response.status(), 200);
      if (scenario === 'collapsed title') {
        assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
        await toggle.click();
      }
      await targetFolder.getByText(tag, { exact: true }).waitFor({ timeout: 5000 });
      await sourceTag.waitFor({ timeout: 5000 });
      await page.reload({ waitUntil: 'domcontentloaded' });
      if (touch) await openDrawer();
      await targetFolder.getByText(tag, { exact: true }).waitFor({ timeout: 5000 });
      assert.deepEqual(errors, []);
      if (evidenceDir) await page.screenshot({ path: join(evidenceDir, `folder-${scenario.replaceAll(' ', '-')}.png`) });
      console.log(`${scenario}: folder PUT ${response.status()}, both memberships visible, destination survives reload`);
    } catch (error) {
      if (evidenceDir) await page.screenshot({ path: join(evidenceDir, `folder-${scenario.replaceAll(' ', '-')}-failure.png`) });
      throw new Error(`${scenario}: ${error.message}`, { cause: error });
    } finally {
      sendRefresh.resolve();
      finishWrite.resolve();
      await context.close();
    }
  }
} finally {
  await browser.close();
}
