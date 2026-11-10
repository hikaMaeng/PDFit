import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// 사이드바 태그 목록의 첫 항목 "미분류"와 `/untagged` 목록을 배포된 서버에서 검증한다.
//  A. 실제 라이브러리(읽기 전용): 첫 항목 위치, 개수 배지, 목록이 API 응답과 일치하는지.
//  B. 서버 응답만 가로챈 시나리오: 미분류 문서에 태그를 붙이면 목록과 배지에서 빠지는지(실제 데이터는 바꾸지 않는다).
const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const runId = process.env.PDFIT_TEST_RUN ?? '20261110_untagged';
const output = new URL(`./reports/untagged/${runId}/`, import.meta.url);
await mkdir(output, { recursive: true });
const shot = (name) => decodeURIComponent(new URL(name, output).pathname.slice(1));

const browser = await chromium.launch({ headless: true, ...(process.env.PDFIT_TEST_CHANNEL ? { channel: process.env.PDFIT_TEST_CHANNEL } : {}) });
const results = {};
const digits = (text) => Number((text ?? '').replace(/[^0-9]/g, ''));

try {
  // ── A. 실제 라이브러리 ─────────────────────────────────────
  {
    const apiBooks = await (await fetch(`${origin}/api/tags/untagged-books`)).json();
    const apiCount = (await (await fetch(`${origin}/api/tags/untagged-count`)).json()).count;
    assert.equal(apiBooks.length, apiCount, 'untagged-books 길이와 untagged-count가 같아야 한다');
    assert.ok(apiBooks.every((book) => book.tags.length === 0), '미분류 응답에 태그가 있는 문서가 섞이면 안 된다');

    const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
    try {
      await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
      const entry = page.getByTestId('lnb-untagged');
      await entry.waitFor({ state: 'visible', timeout: 30000 });
      assert.equal((await entry.innerText()).includes('미분류'), true, '항목 이름이 미분류여야 한다');

      // 첫 번째 항목인지: 태그 섹션 머리글 바로 다음 행이 미분류이고, 그 뒤에 실제 태그 행이 이어진다.
      await page.waitForFunction(() => document.querySelectorAll('.pdfit-tag-row').length > 1, null, { timeout: 30000 }).catch(() => undefined);
      const order = await page.evaluate(() => {
        // 미분류 행은 `.pdfit-tag-row`(실제 태그 행 전용 클래스)가 아니므로 DOM 순서로 비교한다.
        const rows = [...document.querySelectorAll('[data-testid="lnb-untagged-row"], .pdfit-tag-row')];
        return { firstIsUntagged: rows[0]?.getAttribute('data-testid') === 'lnb-untagged-row', rowCount: rows.length, realTagRows: document.querySelectorAll('.pdfit-tag-row').length, untaggedRows: document.querySelectorAll('[data-testid="lnb-untagged-row"]').length };
      });
      assert.equal(order.firstIsUntagged, true, '"미분류"가 태그 목록의 첫 항목이어야 한다');
      assert.equal(order.untaggedRows, 1, '미분류 행은 정확히 하나여야 한다');
      assert.ok(order.realTagRows > 0 && order.rowCount === order.realTagRows + 1, '미분류 뒤에 실제 태그 행이 이어져야 한다');

      await page.waitForFunction((expected) => Number(document.querySelector('[data-testid="lnb-untagged-count"]')?.textContent) === expected, apiCount, { timeout: 15000 });
      const badge = digits(await page.getByTestId('lnb-untagged-count').innerText());
      assert.equal(badge, apiCount, '사이드바 배지가 API 개수와 같아야 한다');
      await page.screenshot({ path: shot('sidebar.png'), clip: { x: 0, y: 0, width: 320, height: 520 } });

      await entry.click();
      await page.waitForURL('**/untagged');
      await page.getByTestId('untagged-title').waitFor({ state: 'visible' });
      assert.equal(await page.getByTestId('untagged-title').innerText(), '미분류');
      await page.waitForFunction(() => document.querySelector('[data-testid="tag-document-count"]'), null, { timeout: 15000 });
      const chip = digits(await page.getByTestId('tag-document-count').innerText());
      assert.equal(chip, apiCount, '제목 옆 문서 수가 API 개수와 같아야 한다');
      assert.equal(await page.locator('[data-testid="pdf-filename-line"]').count(), apiCount, '목록 행 수가 API 개수와 같아야 한다');
      const shown = await page.locator('[data-testid="pdf-filename-line"]').allInnerTexts();
      for (const book of apiBooks) assert.ok(shown.some((text) => text.includes(book.filename.replace(/\.pdf$/i, ''))), `목록에 ${book.filename}이 있어야 한다`);
      const selected = await entry.evaluate((element) => element.classList.contains('Mui-selected'));
      assert.equal(selected, true, '미분류 항목이 선택 상태여야 한다');
      await page.screenshot({ path: shot('untagged-page.png') });

      // 다른 태그로 이동했다가 돌아와도 정상이며, 실제 태그 페이지는 그대로 동작한다.
      const firstTag = page.locator('.pdfit-tag-row:not([data-testid="lnb-untagged-row"]) .MuiListItemButton-root').first();
      await firstTag.click();
      await page.waitForURL('**/tag/**');
      // 라우터가 URL을 바꾼 직후 React가 다시 그리기까지 잠깐 걸리므로 선택 해제를 기다린다.
      await page.waitForFunction(() => !document.querySelector('[data-testid="lnb-untagged"]')?.classList.contains('Mui-selected'), null, { timeout: 5000 })
        .catch(() => assert.fail('실제 태그 페이지에서는 미분류가 선택 해제돼야 한다'));
      assert.equal(await page.getByTestId('untagged-title').count(), 0);
      assert.deepEqual(errors, []);
      results.live = { apiCount, badge, chip, rows: shown.length, firstTagUrl: page.url() };
    } finally { await context.close(); }
  }

  // ── B. 태그를 붙이면 미분류에서 빠진다(서버 변경 응답은 가로챔) ─────
  {
    const books = [
      { folder: '이북', filename: 'E2E 미분류 A.pdf', size: 1000, modified_at: '2026-01-01T00:00:00.000Z', tags: [] },
      { folder: '이북', filename: 'E2E 미분류 B.pdf', size: 2000, modified_at: '2026-01-02T00:00:00.000Z', tags: [] },
    ];
    const posted = [];
    const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
    const json = (route, value) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
    await page.route(`${origin}/api/tags/**`, async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (method === 'GET' && url.pathname === '/api/tags/untagged-books') return json(route, books);
      if (method === 'GET' && url.pathname === '/api/tags/untagged-count') return json(route, { count: books.length });
      if (method === 'POST' && url.pathname.startsWith('/api/tags/book/')) {
        const filename = decodeURIComponent(url.pathname.split('/').pop());
        posted.push({ filename, body: JSON.parse(route.request().postData() ?? '{}') });
        const index = books.findIndex((book) => book.filename === filename);
        if (index >= 0) books.splice(index, 1);
        return json(route, { ok: true });
      }
      if (method === 'PATCH' && url.pathname.endsWith('/color')) return json(route, { ok: true });
      return route.continue();
    });
    try {
      await page.goto(`${origin}/untagged`, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('untagged-title').waitFor({ state: 'visible', timeout: 30000 });
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="pdf-filename-line"]').length === 2, null, { timeout: 15000 });
      assert.equal(digits(await page.getByTestId('lnb-untagged-count').innerText()), 2);

      await page.getByRole('button', { name: '태그관리' }).first().click();
      const input = page.getByRole('combobox', { name: '태그 추가' });
      await input.waitFor({ state: 'visible' });
      await input.fill('e2e-untagged-check');
      await page.getByTestId('add-tag-button').click();
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="pdf-filename-line"]').length === 1, null, { timeout: 15000 });
      await page.waitForFunction(() => Number(document.querySelector('[data-testid="lnb-untagged-count"]')?.textContent) === 1, null, { timeout: 15000 });
      assert.equal(posted.length, 1);
      assert.equal(posted[0].body.tag, 'e2e-untagged-check');
      assert.equal(digits(await page.getByTestId('tag-document-count').innerText()), 1, '제목 옆 문서 수도 1로 줄어야 한다');
      const remaining = await page.locator('[data-testid="pdf-filename-line"]').innerText();
      assert.ok(remaining.includes('E2E 미분류 B'), '태그를 붙인 문서(A)만 빠지고 B는 남아야 한다');
      await page.screenshot({ path: shot('tag-added.png') });
      assert.deepEqual(errors, []);
      results.mocked = { posted, remainingAfterTag: 1 };
    } finally { await context.close(); }
  }

  await writeFile(new URL('result.json', output), JSON.stringify({ status: 'PASS', origin, results }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', results }));
} finally {
  await browser.close();
}
