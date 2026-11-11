import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// 사이드바 태그 머리글의 "인덱스" 아이콘과 `/tag-index` 핀터레스트식 카드 페이지를 배포된 서버에서 검증한다.
//  A. 실제 라이브러리(읽기 전용): 기대 카드를 페이지 코드가 아니라 서버 API(`/api/tags/summary` + 태그마다 `/api/tags/:tag/books`)로
//     따로 만들어 순서·책 수·책 제목·머리글 칩과 DOM을 대조한다.
//  B. 아이콘 위치/동작(접기 상태 유지), 다단 배치(열 2개 이상·높이가 서로 다름), 제목 클릭=뷰어, 카드 머리글 클릭=태그 페이지.
//  C. 좁은 화면(390px) 한 단 배치와 가로 넘침 없음.
//  D. 서버 응답만 가로챈 빈 상태·오류 상태.
const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const runId = process.env.PDFIT_TEST_RUN ?? '20261111_tag-index';
const output = new URL(`./reports/tag-index/${runId}/`, import.meta.url);
await mkdir(output, { recursive: true });
const shot = (name) => decodeURIComponent(new URL(name, output).pathname.slice(1));

const digits = (text) => Number((text ?? '').replace(/[^0-9]/g, ''));
const title = (filename) => filename.replace(/\.pdf$/i, '');
const codeUnitOrder = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const fetchJson = async (path) => { const response = await fetch(`${origin}${path}`); assert.equal(response.status, 200, `${path} → ${response.status}`); return response.json(); };

// ── 서버 API로 기대값을 독립적으로 만든다 ──────────────────
const summary = await fetchJson('/api/tags/summary');
const expected = [];
for (const tag of summary) {
  const books = await fetchJson(`/api/tags/${encodeURIComponent(tag.name)}/books`);
  if (books.length > 0) expected.push({ name: tag.name, summaryCount: tag.bookCount, books });
}
expected.sort((left, right) => codeUnitOrder(left.name, right.name));
const expectedLinks = expected.reduce((total, card) => total + card.books.length, 0);
assert.ok(expected.length > 3, '검증하려면 태그가 여러 개 있어야 한다');
const indexApi = await fetchJson('/api/tags/index');
assert.equal(indexApi.length, expected.length, 'GET /api/tags/index의 태그 수 = summary+books로 만든 태그 수');
for (const card of indexApi) {
  const reference = expected.find((item) => item.name === card.name);
  assert.ok(reference, `index API에 있는 태그 ${card.name}가 summary에 있어야 한다`);
  assert.equal(card.books.length, reference.books.length, `index API ${card.name} 책 수`);
}

const browser = await chromium.launch({ headless: true, ...(process.env.PDFIT_TEST_CHANNEL ? { channel: process.env.PDFIT_TEST_CHANNEL } : {}) });
const results = { expectedTags: expected.length, expectedLinks };

try {
  // ── A·B. 실제 라이브러리 ───────────────────────────────
  {
    const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
    try {
      await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
      const section = page.getByTestId('lnb-tags-section');
      await section.waitFor({ state: 'visible', timeout: 30000 });
      await page.waitForFunction((count) => Number(document.querySelector('[data-testid="tag-assignment-total"]')?.textContent) === count, expectedLinks, { timeout: 30000 });
      const sidebarTotal = digits(await page.getByTestId('tag-assignment-total').innerText());
      assert.equal(sidebarTotal, expectedLinks, '사이드바 합계 = 태그별 책 목록 길이 합');

      // 아이콘 위치: 태그 이름 오른쪽, 합계 숫자 왼쪽(요청한 "이 자리").
      const button = page.getByTestId('lnb-tag-index');
      await button.waitFor({ state: 'visible' });
      const geometry = await page.evaluate(() => {
        const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect();
        const section = rect('[data-testid="lnb-tags-section"]');
        const icon = rect('[data-testid="lnb-tag-index"]');
        const total = rect('[data-testid="tag-assignment-total"]');
        const label = [...document.querySelectorAll('[data-testid="lnb-tags-section"] span')].find((node) => node.textContent?.trim() === '태그')?.getBoundingClientRect();
        return { section, icon, total, label };
      });
      assert.ok(geometry.label && geometry.icon.left >= geometry.label.right - 1, '아이콘은 "태그" 글자 오른쪽에 있어야 한다');
      assert.ok(geometry.icon.right <= geometry.total.left + 1, '아이콘은 합계 숫자 왼쪽에 있어야 한다');
      assert.ok(geometry.icon.top >= geometry.section.top && geometry.icon.bottom <= geometry.section.bottom, '아이콘은 태그 머리글 행 안에 있어야 한다');
      assert.equal(await button.getAttribute('aria-label'), '태그 인덱스 열기');
      await page.screenshot({ path: shot('sidebar.png'), clip: { x: 0, y: 0, width: 320, height: 420 } });

      // 아이콘 클릭: 인덱스 페이지로 이동하고, 머리글 행의 접기/펼치기는 건드리지 않는다.
      assert.equal(await section.getAttribute('aria-expanded'), 'true');
      await button.click();
      await page.waitForURL('**/tag-index');
      assert.equal(await section.getAttribute('aria-expanded'), 'true', '아이콘 클릭이 태그 섹션을 접으면 안 된다');
      await page.getByTestId('tag-index-grid').waitFor({ state: 'visible', timeout: 15000 });
      assert.equal(await button.getAttribute('aria-current'), 'page', '인덱스 페이지에서 아이콘은 현재 페이지 표시');

      // ── A. 카드 대조 ──────────────────────────────────
      await page.waitForFunction((count) => document.querySelectorAll('[data-testid="tag-index-card"]').length === count, expected.length, { timeout: 15000 });
      const dom = await page.evaluate(() => [...document.querySelectorAll('[data-testid="tag-index-card"]')].map((card) => ({
        tag: card.getAttribute('data-tag'),
        count: card.querySelector('[data-testid="tag-index-card-count"]')?.textContent ?? '',
        titles: [...card.querySelectorAll('[data-testid="tag-index-book"]')].map((anchor) => anchor.textContent ?? ''),
        hrefs: [...card.querySelectorAll('[data-testid="tag-index-book"]')].map((anchor) => anchor.getAttribute('href') ?? ''),
      })));
      assert.deepEqual(dom.map((card) => card.tag), expected.map((card) => card.name), '카드 순서 = 태그 이름의 유니코드 순(사이드바와 같음)');
      for (const [index, card] of dom.entries()) {
        const reference = expected[index];
        assert.equal(digits(card.count), reference.books.length, `${card.tag}: 카드 숫자 = API 책 수`);
        assert.equal(reference.books.length, reference.summaryCount, `${card.tag}: API 책 목록 길이 = summary.bookCount`);
        assert.deepEqual([...card.titles].sort(codeUnitOrder), reference.books.map((book) => title(book.filename)).sort(codeUnitOrder), `${card.tag}: 카드 책 제목 = API 책 제목(중복 포함)`);
        const expectedHrefs = reference.books.map((book) => `/viewer/${encodeURIComponent(book.folder)}/${encodeURIComponent(book.filename)}`).sort(codeUnitOrder);
        assert.deepEqual(card.hrefs.map((href) => href.split('?')[0]).sort(codeUnitOrder), expectedHrefs, `${card.tag}: 링크 = 뷰어 주소`);
      }
      const chip = await page.getByTestId('tag-index-summary').innerText();
      assert.equal(chip, `태그 ${expected.length}개 · 책 연결 ${expectedLinks}건`, '머리글 칩 문구와 숫자');
      assert.equal(await page.getByRole('heading', { level: 1, name: '인덱스' }).count(), 1);
      // 큰 폰트 확인: 책 제목은 작은 글씨여야 한다(요청: "작은 폰트").
      const fontPx = await page.locator('[data-testid="tag-index-book"]').first().evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
      assert.ok(fontPx > 0 && fontPx <= 12.5, `책 제목 글꼴 크기 ${fontPx}px`);

      // ── B. 다단(핀터레스트) 배치 ────────────────────────
      const layout = await page.evaluate(() => {
        const grid = document.querySelector('[data-testid="tag-index-grid"]');
        const cards = [...document.querySelectorAll('[data-testid="tag-index-card"]')].map((card) => { const box = card.getBoundingClientRect(); return { left: Math.round(box.left), width: Math.round(box.width), height: Math.round(box.height) }; });
        return { columns: new Set(cards.map((card) => card.left)).size, heights: new Set(cards.map((card) => card.height)).size, minHeight: Math.min(...cards.map((card) => card.height)), maxHeight: Math.max(...cards.map((card) => card.height)), overflowX: grid.scrollWidth - grid.clientWidth };
      });
      assert.ok(layout.columns >= 2, `카드가 2열 이상으로 배치돼야 한다(열 ${layout.columns})`);
      assert.ok(layout.heights >= 3 && layout.maxHeight > layout.minHeight * 1.5, `카드 높이가 제각각이어야 한다(최소 ${layout.minHeight}, 최대 ${layout.maxHeight})`);
      assert.ok(layout.overflowX <= 0, '카드가 가로로 넘치면 안 된다');
      await page.screenshot({ path: shot('index-page.png') });
      await page.locator('[data-testid="tag-index-card"]').first().scrollIntoViewIfNeeded();

      // 제목 클릭 = 뷰어 열기
      const firstBook = page.locator('[data-testid="tag-index-card"]').first().locator('[data-testid="tag-index-book"]').first();
      const firstBookHref = await firstBook.getAttribute('href');
      const popupPromise = context.waitForEvent('page', { timeout: 15000 });
      await firstBook.click();
      const popup = await popupPromise;
      await popup.waitForURL('**/viewer/**', { timeout: 15000 });
      assert.equal(new URL(popup.url()).pathname, new URL(firstBookHref, origin).pathname, '제목 클릭이 해당 책의 뷰어 주소를 연다');
      await popup.close();
      assert.ok(page.url().endsWith('/tag-index'), '뷰어는 새 창에서 열리고 인덱스 페이지는 그대로다');

      // 카드 머리글 클릭 = 태그 페이지
      const firstCard = page.locator('[data-testid="tag-index-card"]').first();
      const firstTag = await firstCard.getAttribute('data-tag');
      await firstCard.getByTestId('tag-index-card-title').click();
      await page.waitForURL(`**/tag/${encodeURIComponent(firstTag)}`);
      await page.getByTestId('tag-document-count').waitFor({ state: 'visible', timeout: 15000 });
      assert.equal(digits(await page.getByTestId('tag-document-count').innerText()), expected[0].books.length, '태그 페이지 문서 수 = 카드 숫자');

      assert.deepEqual(errors, []);
      results.live = { cards: dom.length, chip, columns: layout.columns, minHeight: layout.minHeight, maxHeight: layout.maxHeight, fontPx, sidebarTotal, popupPath: new URL(popup.url()).pathname };
    } finally { await context.close(); }
  }

  // ── C. 좁은 화면 ──────────────────────────────────────
  {
    const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    try {
      await page.goto(`${origin}/tag-index`, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('tag-index-grid').waitFor({ state: 'visible', timeout: 30000 });
      await page.waitForFunction((count) => document.querySelectorAll('[data-testid="tag-index-card"]').length === count, expected.length, { timeout: 15000 });
      const mobile = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('[data-testid="tag-index-card"]')].map((card) => card.getBoundingClientRect());
        return { columns: new Set(cards.map((box) => Math.round(box.left))).size, rightmost: Math.max(...cards.map((box) => box.right)), viewport: window.innerWidth, pageOverflow: document.documentElement.scrollWidth - window.innerWidth };
      });
      assert.ok(mobile.columns <= 2, `좁은 화면에서는 1~2열이어야 한다(열 ${mobile.columns})`);
      assert.ok(mobile.rightmost <= mobile.viewport + 1 && mobile.pageOverflow <= 0, `가로로 넘치면 안 된다(오른쪽 끝 ${mobile.rightmost}/${mobile.viewport})`);
      await page.screenshot({ path: shot('index-mobile.png') });
      results.mobile = mobile;
    } finally { await context.close(); }
  }

  // ── E. 다크/라이트 모드: 책 제목·태그 이름 글자색과 카드 배경의 대비(WCAG AA 4.5:1) ─────
  for (const mode of ['dark', 'light']) {
    const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 900 } });
    await context.addInitScript((value) => { try { window.localStorage.setItem('pdfit.color-mode', value); } catch { /* ignore */ } }, mode);
    const page = await context.newPage();
    try {
      await page.goto(`${origin}/tag-index`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction((count) => document.querySelectorAll('[data-testid="tag-index-card"]').length === count, expected.length, { timeout: 30000 });
      const contrast = await page.evaluate(() => {
        const parse = (value) => { const match = value.match(/rgba?\(([^)]+)\)/); const [r, g, b, a = 1] = match[1].split(',').map((part) => Number(part.trim())); return { r, g, b, a }; };
        const luminance = ({ r, g, b }) => { const channel = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b); };
        const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
        const backgroundOf = (node) => { let current = node; let color = { r: 0, g: 0, b: 0, a: 0 }; const layers = []; while (current) { const parsed = parse(getComputedStyle(current).backgroundColor); if (parsed.a > 0) layers.push(parsed); if (parsed.a === 1) break; current = current.parentElement; } for (const layer of layers.reverse()) color = color.a === 0 ? layer : over(layer, color); return color.a === 0 ? { r: 255, g: 255, b: 255, a: 1 } : color; };
        const ratio = (node) => { const background = backgroundOf(node); const foreground = over(parse(getComputedStyle(node).color), background); const [light, dark] = [luminance(foreground), luminance(background)].sort((x, y) => y - x); return Number(((light + 0.05) / (dark + 0.05)).toFixed(2)); };
        const book = document.querySelector('[data-testid="tag-index-book"]');
        const heading = document.querySelector('[data-testid="tag-index-card-title"] h2');
        const count = document.querySelector('[data-testid="tag-index-card-count"]');
        return { book: ratio(book), heading: ratio(heading), count: ratio(count), bodyBackground: getComputedStyle(document.body).backgroundColor };
      });
      assert.ok(contrast.book >= 4.5, `${mode}: 책 제목 대비 ${contrast.book}:1 (4.5 이상이어야 한다)`);
      assert.ok(contrast.heading >= 4.5, `${mode}: 태그 이름 대비 ${contrast.heading}:1`);
      assert.ok(contrast.count >= 4.5, `${mode}: 책 수 숫자 대비 ${contrast.count}:1`);
      await page.screenshot({ path: shot(`index-${mode}.png`) });
      results[`contrast_${mode}`] = { mode, ...contrast };
    } finally { await context.close(); }
  }

  // ── D. 빈 상태·오류 상태(서버 응답 가로채기) ───────────
  for (const scenario of ['empty', 'error']) {
    const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.route(`${origin}/api/tags/index`, (route) => scenario === 'empty'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      : route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) }));
    try {
      await page.goto(`${origin}/tag-index`, { waitUntil: 'domcontentloaded' });
      if (scenario === 'empty') {
        await page.getByTestId('tag-index-empty').waitFor({ state: 'visible', timeout: 15000 });
        assert.equal(await page.getByTestId('tag-index-empty').innerText(), '태그가 붙은 책이 아직 없습니다.');
        assert.equal(await page.getByTestId('tag-index-card').count(), 0);
      } else {
        await page.getByRole('alert').waitFor({ state: 'visible', timeout: 15000 });
        assert.ok((await page.getByRole('alert').innerText()).includes('boom'));
        assert.equal(await page.getByTestId('tag-index-card').count(), 0);
      }
      results[scenario] = 'PASS';
    } finally { await context.close(); }
  }

  await writeFile(new URL('result.json', output), JSON.stringify({ status: 'PASS', origin, results }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', results }));
} finally {
  await browser.close();
}
