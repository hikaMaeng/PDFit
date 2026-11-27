import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

// Run only against a test library with copies of the two scanned PDFs. This test writes their outlines.
const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15234';
const output = process.env.PDFIT_TEST_OUTPUT ?? 'test/20261120/outline-quality';
const books = [
  {
    file: 'MCP로 똑똑하게 일하는 법.pdf', key: 'mcp', secondPage: 225, engine: 'legacy',
    expected: [5, 8, 13, 15, 21, 24, 29, 31, 34, 37, 40, 45, 47, 62, 63, 73, 81, 95, 103, 108,
      117, 119, 134, 156, 164, 173, 175, 185, 202, 210, 214, 221, null], clickRow: 11,
  },
  {
    file: '요즘 AI 개발은 SLM.pdf', key: 'slm', secondPage: 89, engine: 'gpu', isbn: '9791199401488',
    expected: [7, 9, 9, 9, 11, 13, 15, 18, 22, 22, 25, 27, 29, 32, 32, 32, 35, 39, 43, 46, 51, 51, 53, 56, 59,
      63, 66, 66, 66, 68, 71, 74, 79, 79, 81, 83, 85, 90, 93, 93, 95, 98, 101, 106, 106, 106, 108, 111, 114,
      120, 120, 123, 127, 132, 135, 140, 140, 142, 145, 147, 149, 149, 152, 155], clickRow: 39,
  },
];
await mkdir(output, { recursive: true });
assert.equal((await fetch(`${origin}/health`)).status, 200);
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const run = [];
try {
  for (const book of books) {
    const suffix = `/OutlineQuality/${encodeURIComponent(book.file)}`;
    const api = `${origin}/api/outlines${suffix}`;
    const prior = [1, book.secondPage].map((page, i) => ({ key: String(i), title: String(i + 1), page, depth: 0 }));
    const generated = book.key === 'slm';
    assert.equal((await fetch(api, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries: prior, generated }),
    })).status, 200);
    assert.equal((await fetch(api)).status, generated ? 404 : 200);

    const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    const lookups = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (new URL(response.url()).pathname.endsWith('/yes24')) lookups.push(response);
    });
    try {
      await page.goto(`${origin}/viewer${suffix}?engine=${book.engine}`, { waitUntil: 'domcontentloaded' });
      const button = page.getByRole('button', { name: '목차', exact: true });
      const started = Date.now();
      await button.click({ timeout: 45_000 });
      const dialog = page.getByRole('dialog', { name: '목차' });
      const list = dialog.getByTestId('pdf-outline-list');
      if (!generated) {
        await list.and(dialog.locator('[data-source="stored"]')).waitFor();
        await dialog.getByRole('button', { name: '재생성' }).click();
      }
      await list.and(dialog.locator('[data-source="yes24"]')).waitFor({ timeout: 90_000 });
      const durationMs = Date.now() - started;
      assert.equal(await list.getAttribute('data-source'), 'yes24');
      assert.equal(await page.getByTestId('pdfgpu-scroll-area').count(), book.engine === 'gpu' ? 1 : 0);
      assert.equal(lookups.length, 1);
      assert.equal(lookups[0].status(), 200);
      if (book.isbn) assert.equal(new URL(lookups[0].url()).searchParams.get('isbn'), book.isbn);

      const entries = dialog.getByTestId('pdf-outline-entry');
      const pages = await entries.evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('data-page')) || null));
      assert.deepEqual(pages, book.expected);
      const stored = await (await fetch(api)).json();
      assert.deepEqual(stored.entries.map((entry) => entry.page), book.expected);
      assert.ok(stored.entries.every(({ title }) => /\p{L}/u.test(title)));
      await page.screenshot({ path: join(output, `${book.key}-viewer.png`) });

      await entries.nth(book.clickRow).click();
      const target = book.expected[book.clickRow];
      const indicator = page.getByRole('textbox', { name: '페이지 번호' });
      await indicator.and(page.locator(`input[value="${target}"]`)).waitFor();
      assert.equal(await dialog.isVisible(), true);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await button.click({ timeout: 45_000 });
      await list.waitFor();
      assert.equal(await list.getAttribute('data-source'), 'stored');
      assert.equal(lookups.length, 1);
      assert.deepEqual(errors, []);
      run.push({ book: book.key, listed: pages.length, linked: pages.filter(Boolean).length, target, durationMs, errors });
      console.log(`PASS ${book.key} ${pages.filter(Boolean).length}/${pages.length} linked, clicked page ${target}`);
    } catch (error) {
      run.push({ book: book.key, error: error.message, errors });
      await page.screenshot({ path: join(output, `${book.key}-failure.png`) }).catch(() => undefined);
      throw error;
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  await writeFile(join(output, 'browser-results.json'), JSON.stringify(run, null, 2));
}
