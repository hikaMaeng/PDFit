import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const evidenceDir = process.env.PDFIT_TEST_ARTIFACT_DIR;
const filename = 'Drag test.pdf';
const folder = 'Drag test library';
const sourceTag = 'Source';
const targetTag = 'Destination';
const bookPath = `/api/tags/book/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`;
const coverImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

if (evidenceDir) await mkdir(evidenceDir, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PDFIT_TEST_CHANNEL ?? 'chrome' });
try {
  for (const scenario of ['list title', 'hovered cover', 'pinned cover', 'cover title']) {
    const view = scenario === 'list title' ? 'list' : 'covers';
    const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    await context.addInitScript((value) => localStorage.setItem('pdfit.library.view', value), view);
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const book = { folder, filename, size: 1024, modified_at: '2026-11-23T00:00:00.000Z', tags: [sourceTag] };
    const existingBook = { ...book, filename: 'Existing.pdf', tags: [targetTag] };

    // The deployed UI runs normally against an isolated book and two tags.
    await page.route('**/api/folders/cache', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/tag-folders', (route) => route.fulfill({ json: [] }));
    await page.route('**/api/folders/*/files/*/thumbnail?*', (route) => route.fulfill({ contentType: 'image/png', body: coverImage }));
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
      await page.goto(`${origin}/tag/${sourceTag}`, { waitUntil: 'domcontentloaded' });
      const targetRow = page.getByTestId('lnb-tag-row').filter({ hasText: targetTag });
      const target = targetRow.getByText(targetTag, { exact: true });
      const card = page.getByTestId('pdf-cover-card').filter({ has: page.getByRole('link', { name: filename, exact: true }) });
      let source = page.getByRole('link', { name: filename, exact: true });
      let sourcePosition;
      if (view === 'covers') {
        await page.waitForFunction(() => document.querySelector('[data-testid="pdf-cover-thumbnail"] img')?.naturalWidth > 0, null, { timeout: 10000 });
        source = card.getByTestId('pdf-cover-title-row').getByRole('link', { name: filename, exact: true });
        if (scenario !== 'cover title') {
          if (scenario === 'pinned cover') await card.getByTestId('pdf-cover-info-toggle').click();
          await card.getByTestId('pdf-cover-media').hover({ timeout: 5000 });
          source = card.getByTestId('pdf-cover-info-overlay');
          // Use the center of the visible cover body, below the card's buttons and tag chips.
          const box = await source.boundingBox();
          assert.ok(box, 'the info overlay must cover the thumbnail');
          sourcePosition = { x: box.width / 2, y: box.height * 0.75 };
        }
      }

      const [response] = await Promise.all([
        page.waitForResponse((response) => new URL(response.url()).pathname === bookPath && response.request().method() === 'POST', { timeout: 5000 }),
        source.dragTo(target, { sourcePosition, timeout: 5000 }),
      ]);
      assert.ok(response.ok(), 'the tag add request must succeed');
      assert.deepEqual(response.request().postDataJSON(), { tag: targetTag });
      await targetRow.getByText('2', { exact: true }).waitFor({ timeout: 5000 });
      await target.click();
      await page.waitForURL(`**/tag/${targetTag}`);
      await page.getByRole('link', { name: existingBook.filename, exact: true }).waitFor({ timeout: 5000 });
      if (view === 'covers') source = card.getByTestId('pdf-cover-title-row').getByRole('link', { name: filename, exact: true });
      await source.waitFor({ timeout: 5000 });
      assert.deepEqual(pageErrors, []);
      if (evidenceDir) await page.screenshot({ path: join(evidenceDir, `${scenario.replaceAll(' ', '-')}.png`) });
      console.log(`${scenario}: tag POST ${response.status()}, sidebar count updated, book visible in destination`);
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
