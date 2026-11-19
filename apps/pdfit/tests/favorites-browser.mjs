import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

// 즐겨찾기를 배포된 서버에서 검증한다.
//  A. API: DB에 없는 책은 켜지지 않고, 켜고 끄면 목록이 따라온다.
//  B. 화면: 사이드바 "즐겨찾기"가 태그 섹션보다 위에 있고, 카드·목록 행의 별이 토글되며,
//     즐겨찾기 보기에 모이고 거기서 별을 끄면 목록에서 빠진다.
// 실제 라이브러리의 책 하나를 잠깐 켰다가 끝에서 반드시 원래 상태로 되돌린다.
const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const runId = process.env.PDFIT_TEST_RUN ?? '20261120_favorites';
const output = new URL(`./reports/favorites/${runId}/`, import.meta.url);
await mkdir(output, { recursive: true });
const shot = (name) => decodeURIComponent(new URL(name, output).pathname.slice(1));
const api = (path, init) => fetch(`${origin}/api/favorites${path}`, init);
const keyPath = (book) => `/${encodeURIComponent(book.folder)}/${encodeURIComponent(book.filename)}`;
const digits = (text) => Number((text ?? '').replace(/[^0-9]/g, ''));

const browser = await chromium.launch({ headless: true, ...(process.env.PDFIT_TEST_CHANNEL ? { channel: process.env.PDFIT_TEST_CHANNEL } : {}) });
const results = {};
let target = null;
let wasFavorite = false;

try {
  // 대상 책: 태그가 붙은 첫 책(태그 페이지에서 카드와 행을 둘 다 볼 수 있다).
  const summaries = await (await fetch(`${origin}/api/tags/summary`)).json();
  assert.ok(summaries.length > 0, '태그가 있는 라이브러리가 필요하다');
  const tag = summaries[0].name;
  const tagBooks = await (await fetch(`${origin}/api/tags/${encodeURIComponent(tag)}/books`)).json();
  assert.ok(tagBooks.length > 0);
  const baseline = await (await api('')).json();
  target = tagBooks.find((book) => !baseline.some((row) => row.folder === book.folder && row.filename === book.filename)) ?? tagBooks[0];
  wasFavorite = baseline.some((row) => row.folder === target.folder && row.filename === target.filename);
  await api(keyPath(target), { method: 'DELETE' });
  const start = (await (await api('')).json()).length;

  // ── A. API ────────────────────────────────────────────────
  {
    const ghost = await api('/%EC%97%86%EC%9D%8C/ghost-never-indexed.pdf', { method: 'PUT' });
    assert.equal(ghost.status, 200);
    assert.equal((await ghost.json()).favorite, false, 'books에 없는 책은 즐겨찾기가 켜지면 안 된다');
    const on = await (await api(keyPath(target), { method: 'PUT' })).json();
    assert.equal(on.favorite, true);
    const keys = await (await api('')).json();
    assert.equal(keys.length, start + 1);
    const records = await (await api('/books')).json();
    const found = records.find((book) => book.folder === target.folder && book.filename === target.filename);
    assert.ok(found, '/books에 켠 책이 있어야 한다');
    assert.ok(Array.isArray(found.tags) && found.tags.includes(tag), '/books 레코드에 태그 목록이 있어야 한다');
    await api(keyPath(target), { method: 'DELETE' });
    assert.equal((await (await api('')).json()).length, start);
    results.api = { start, ghostIgnored: true };
  }

  // ── B. 화면 ───────────────────────────────────────────────
  const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => { try { localStorage.setItem('pdfit.library.view', 'covers'); } catch { /* ignore */ } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
  try {
    await page.goto(`${origin}/tag/${encodeURIComponent(tag)}`, { waitUntil: 'domcontentloaded' });
    const entry = page.getByTestId('lnb-favorites');
    await entry.waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForFunction((expected) => Number(document.querySelector('[data-testid="lnb-favorites-count"]')?.textContent) === expected, start, { timeout: 15000 });

    // 태그 섹션보다 위에 있다.
    const above = await page.evaluate(() => {
      const favorites = document.querySelector('[data-testid="lnb-favorites"]');
      const tags = document.querySelector('[data-testid="lnb-tags-section"]');
      return Boolean(favorites && tags && (favorites.compareDocumentPosition(tags) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    assert.equal(above, true, '"즐겨찾기"가 태그 섹션보다 위에 있어야 한다');
    await page.screenshot({ path: shot('sidebar.png'), clip: { x: 0, y: 0, width: 320, height: 520 } });

    // 카드: 별이 비어 있다가 켜진다.
    const card = page.getByTestId('pdf-cover-card').filter({ hasText: target.filename }).first();
    await card.waitFor({ state: 'visible', timeout: 30000 });
    const star = card.getByTestId('favorite-toggle');
    assert.equal(await star.getAttribute('aria-pressed'), 'false');
    assert.equal(await star.getAttribute('aria-label'), '즐겨찾기에 추가');
    await star.click();
    await page.waitForFunction((expected) => Number(document.querySelector('[data-testid="lnb-favorites-count"]')?.textContent) === expected, start + 1, { timeout: 15000 });
    assert.equal(await star.getAttribute('aria-pressed'), 'true');
    assert.equal(await star.getAttribute('aria-label'), '즐겨찾기에서 제거');
    assert.equal((await (await api('')).json()).length, start + 1, '서버에 반영돼야 한다');
    await card.screenshot({ path: shot('card-on.png') });

    // 목록 보기: 같은 책의 별이 켜져 있다.
    await page.getByRole('button', { name: '목록 보기' }).click();
    const row = page.locator('li.pdfit-pdf-row').filter({ hasText: target.filename }).first();
    await row.waitFor({ state: 'visible', timeout: 15000 });
    assert.equal(await row.getByTestId('favorite-toggle').getAttribute('aria-pressed'), 'true', '목록 행도 같은 상태를 보여야 한다');
    await row.screenshot({ path: shot('row-on.png') });

    // 즐겨찾기 보기.
    await entry.click();
    await page.waitForURL('**/favorites');
    await page.getByTestId('favorites-title').waitFor({ state: 'visible' });
    assert.equal(await page.getByTestId('favorites-title').innerText(), '즐겨찾기');
    await page.waitForFunction(() => document.querySelectorAll('li.pdfit-pdf-row').length > 0, null, { timeout: 15000 });
    assert.equal(digits(await page.getByTestId('tag-document-count').innerText()), start + 1);
    const favoriteRow = page.locator('li.pdfit-pdf-row').filter({ hasText: target.filename }).first();
    await favoriteRow.waitFor({ state: 'visible' });
    await page.screenshot({ path: shot('favorites-page.png') });

    // 여기서 별을 끄면 목록과 배지에서 빠진다.
    await favoriteRow.getByTestId('favorite-toggle').click();
    await page.waitForFunction((name) => ![...document.querySelectorAll('li.pdfit-pdf-row')].some((li) => li.textContent.includes(name)), target.filename, { timeout: 15000 });
    await page.waitForFunction((expected) => Number(document.querySelector('[data-testid="lnb-favorites-count"]')?.textContent) === expected, start, { timeout: 15000 });
    assert.equal((await (await api('')).json()).length, start);
    assert.deepEqual(errors, []);
    results.ui = { tag, book: target.filename, start };
  } finally { await context.close(); }

  console.log(JSON.stringify({ ok: true, origin, results }, null, 2));
} finally {
  if (target) await api(keyPath(target), { method: wasFavorite ? 'PUT' : 'DELETE' }).catch(() => undefined);
  await browser.close();
}
