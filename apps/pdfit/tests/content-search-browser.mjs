import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.env.PDFIT_TEST_BASE_URL ?? 'http://127.0.0.1:15203';
const output = path.resolve(process.env.PDFIT_TEST_OUTPUT ?? 'test/20261123/content-search');
const api = '**/api/search/**';
const query = '검색 예제';
const scopes = [
  ['목차', 'outline', '목차의 검색 예제', 4],
  ['페이지 OCR', 'page-ocr', '본문의 검색 예제', 7],
  ['클립 OCR', 'clip-ocr', '클립에서 읽은 검색 예제', 8],
  ['클립 메모', 'clip-memo', '메모에 입력한 검색 예제', 9],
];
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: process.env.PDFIT_TEST_CHROMIUM_PATH });
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  await page.addInitScript(() => localStorage.setItem('pdfit.language', 'ko'));
  const requests = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/search/')) requests.push([url.pathname, url.searchParams.get('q')]);
  });
  await page.route(api, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/books')) return route.fulfill({ json: { total: 0, books: [] } });
    const hit = scopes.find(([, scope]) => url.pathname.endsWith('/' + scope));
    await route.fulfill({ json: {
      hits: hit ? [{ id: hit[1], folder: '문서', filename: '예제.pdf', page: hit[3], snippet: hit[2] }] : [],
      hasMore: false,
    } });
  });
  await page.goto(base);
  await page.getByTestId('lnb-search-input').fill(query);
  await page.getByTestId('lnb-search-input').press('Enter');
  await page.getByTestId('search-result-count').waitFor();
  assert.equal(await page.getByRole('tab', { name: '제목' }).getAttribute('aria-selected'), 'true');
  assert.deepEqual(requests, [['/api/search/books', query]]);
  await page.screenshot({ path: path.join(output, '01-default-title.png') });

  for (const [label, scope, snippet, pageNumber] of scopes) {
    const count = requests.length;
    await page.getByRole('tab', { name: label, exact: true }).click();
    const panel = page.getByRole('tabpanel', { name: label });
    await panel.getByText(snippet, { exact: true }).waitFor();
    assert.match(await panel.getByRole('link', { name: '예제.pdf' }).getAttribute('href'), new RegExp('page=' + pageNumber + '$'));
    assert.equal(new URL(page.url()).searchParams.get('scope'), scope);
    assert.deepEqual(requests.slice(count), [['/api/search/content/' + scope, query]]);
    await page.screenshot({ path: path.join(output, '02-' + scope + '.png') });
  }

  await page.getByTestId('lnb-search-input').fill('다른 검색어');
  await page.getByTestId('lnb-search-input').press('Enter');
  await page.getByTestId('search-result-count').waitFor();
  assert.equal(new URL(page.url()).searchParams.get('scope'), null);
  assert.deepEqual(requests.at(-1), ['/api/search/books', '다른 검색어']);

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.addInitScript(() => localStorage.setItem('pdfit.language', 'ko'));
  await mobile.route(api, (route) => route.fulfill({ json: { hits: [], hasMore: false } }));
  await mobile.goto(`${base}/search?q=${encodeURIComponent(query)}&scope=clip-memo`);
  await mobile.getByRole('tabpanel', { name: '클립 메모' }).getByText('일치하는 텍스트가 없습니다.').waitFor();
  assert.equal(await mobile.getByRole('tab', { name: '클립 메모' }).getAttribute('aria-selected'), 'true');
  await mobile.screenshot({ path: path.join(output, '03-mobile-clip-memo.png') });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ requests, errors, output }));
} finally {
  await browser.close();
}
