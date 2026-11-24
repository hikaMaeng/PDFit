import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { startPointerDrag } from './drag-pointer.mjs';

const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const evidenceDir = process.env.PDFIT_TEST_ARTIFACT_DIR;
const filename = 'Drag test.pdf';
const folder = 'Drag test library';
const sourceTag = 'Source';
const targetTag = 'Destination';
const tagFolder = 'Test shelf';
const bookPath = `/api/tags/book/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`;
const coverImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

if (evidenceDir) await mkdir(evidenceDir, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PDFIT_TEST_CHANNEL ?? 'chrome' });
try {
  for (const scenario of ['list title', 'hovered cover', 'pinned cover', 'cover title', 'search cover', 'narrow mouse', 'phone touch']) {
    const view = scenario === 'list title' ? 'list' : 'covers';
    const touch = scenario === 'phone touch';
    const narrow = touch || scenario === 'narrow mouse';
    const viewport = touch ? { width: 390, height: 844 } : { width: narrow ? 820 : 1440, height: 900 };
    const context = await browser.newContext({ locale: 'en-US', viewport, hasTouch: touch, isMobile: touch, serviceWorkers: 'block' });
    const tagFolderId = '2bd9fb2c-70e6-47f3-8eb7-81d2ac92c884';
    await context.addInitScript(({ view, narrow, tagFolderId }) => {
      localStorage.setItem('pdfit.library.view', view);
      if (narrow && !localStorage.getItem('pdfit.lnb.collapsedTagFolders')) {
        localStorage.setItem('pdfit.lnb.collapsedTagFolders', JSON.stringify({ ids: [tagFolderId] }));
      }
    }, { view, narrow, tagFolderId });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const book = { folder, filename, size: 1024, modified_at: '2026-11-23T00:00:00.000Z', tags: [sourceTag] };
    const existingBook = { ...book, filename: 'Existing.pdf', tags: [targetTag] };

    // The deployed UI runs normally against an isolated book and two tags.
    await page.route('**/api/folders/cache', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/tag-folders', (route) => route.fulfill({ json: [
      { id: tagFolderId, name: tagFolder, color: null, tags: [targetTag] },
    ] }));
    await page.route('**/api/folders/*/files/*/thumbnail?*', (route) => route.fulfill({ contentType: 'image/png', body: coverImage }));
    await page.route('**/api/search/books?*', (route) => route.fulfill({ json: { total: 1, books: [book] } }));
    await page.route('**/api/tags/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      const method = route.request().method();
      if (method === 'GET') {
        if (path === '/api/tags/summary') {
          return route.fulfill({ json: [
            { name: sourceTag, bookCount: 1, color: '#22c55e' },
            { name: targetTag, bookCount: book.tags.includes(targetTag) ? 2 : 1, color: '#22c55e' },
          ] });
        }
        if (path === `/api/tags/${sourceTag}/books`) return route.fulfill({ json: [book] });
        if (path === `/api/tags/${targetTag}/books`) return route.fulfill({ json: book.tags.includes(targetTag) ? [book, existingBook] : [existingBook] });
        if (path === bookPath) return route.fulfill({ json: book.tags });
        return route.continue();
      }
      // Prevent any tag writes to the real library during the test.
      if (method !== 'POST' || path !== bookPath || route.request().postDataJSON()?.tag !== targetTag) {
        return route.fulfill({ status: 400, json: { error: 'Unexpected tag write' } });
      }
      book.tags.push(targetTag);
      return route.fulfill({ json: { ok: true } });
    });

    try {
      const sourcePath = scenario === 'search cover' ? '/search?q=Drag' : `/tag/${sourceTag}`;
      await page.goto(`${origin}${sourcePath}`, { waitUntil: 'domcontentloaded' });
      const targetRow = page.getByTestId('lnb-folder-tag-row').filter({ hasText: targetTag });
      const target = targetRow.getByText(targetTag, { exact: true });
      const card = page.getByTestId('pdf-cover-card').filter({ has: page.getByRole('link', { name: filename, exact: true }) });
      let source = page.getByRole('link', { name: filename, exact: true });
      let sourcePosition;
      if (view === 'covers') {
        await page.waitForFunction(() => document.querySelector('[data-testid="pdf-cover-thumbnail"] img')?.naturalWidth > 0, null, { timeout: 10000 });
        source = card.getByTestId('pdf-cover-title-row').getByRole('link', { name: filename, exact: true });
        if (scenario === 'hovered cover' || scenario === 'pinned cover') {
          if (scenario === 'pinned cover') await card.getByTestId('pdf-cover-info-toggle').click();
          await card.getByTestId('pdf-cover-media').hover({ timeout: 5000 });
          source = card.getByTestId('pdf-cover-info-overlay');
          // Use the center of the visible cover body, below the card's buttons and tag chips.
          const box = await source.boundingBox();
          assert.ok(box, 'the info overlay must cover the thumbnail');
          sourcePosition = { x: box.width / 2, y: box.height * 0.75 };
        }
      }

      const drag = async () => {
        if (!narrow) return source.dragTo(target, { sourcePosition, timeout: 5000 });
        assert.equal(await targetRow.count(), 0, 'the tag is in a closed folder in a closed drawer');
        const grip = card.getByTestId('pdf-cover-drag-handle');
        const folderButton = page.getByRole('button', { name: tagFolder, exact: true });
        const canceled = await startPointerDrag(page, grip, { touch });
        await folderButton.waitFor({ timeout: 5000 });
        if (touch) await canceled.cancel();
        else {
          await page.keyboard.press('Escape');
          await canceled.drop();
        }
        await folderButton.waitFor({ state: 'hidden', timeout: 5000 });
        const pointer = await startPointerDrag(page, touch ? grip : source, { touch });
        await folderButton.waitFor({ timeout: 5000 });
        assert.equal(await folderButton.getAttribute('aria-expanded'), 'false');
        await pointer.over(folderButton);
        await pointer.over(target);
        if (evidenceDir) await page.screenshot({ path: join(evidenceDir, `${scenario.replaceAll(' ', '-')}-drag.png`) });
        await pointer.drop();
        await folderButton.waitFor({ state: 'hidden', timeout: 5000 });
        await page.getByRole('button', { name: 'Open menu', exact: true }).click();
      };

      const [response] = await Promise.all([
        page.waitForResponse((response) => new URL(response.url()).pathname === bookPath && response.request().method() === 'POST', { timeout: narrow ? 15000 : 5000 }),
        drag(),
      ]);
      assert.ok(response.ok(), 'the tag add request must succeed');
      assert.deepEqual(response.request().postDataJSON(), { tag: targetTag });
      await targetRow.getByText('2', { exact: true }).waitFor({ timeout: 5000 });
      if (narrow) await page.keyboard.press('Escape');
      if (view === 'covers' && scenario !== 'pinned cover') await card.getByTestId('pdf-cover-info-toggle').click();
      const tags = view === 'covers' ? card.getByTestId('pdf-cover-tags') : page.getByTestId('pdf-tag-values');
      await tags.getByTitle(targetTag, { exact: true }).waitFor({ timeout: 5000 });
      if (evidenceDir) await page.screenshot({ path: join(evidenceDir, `${scenario.replaceAll(' ', '-')}.png`) });
      if (narrow) await page.getByRole('button', { name: 'Open menu', exact: true }).click();
      await target.click();
      await page.waitForURL(`**/tag/${targetTag}`);
      await page.getByRole('link', { name: existingBook.filename, exact: true }).waitFor({ timeout: 5000 });
      if (view === 'covers') source = card.getByTestId('pdf-cover-title-row').getByRole('link', { name: filename, exact: true });
      await source.waitFor({ timeout: 5000 });
      assert.deepEqual(pageErrors, []);
      console.log(`${scenario}: tag POST ${response.status()}, current book and sidebar updated, book visible in destination`);
    } catch (error) {
      if (evidenceDir) await page.screenshot({ path: join(evidenceDir, `${scenario.replaceAll(' ', '-')}-failure.png`) });
      throw new Error(`${scenario}: ${error.message}`, { cause: error });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
