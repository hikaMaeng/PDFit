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
const screenshot = (page, name) => page.screenshot({ path: path.join(output, name + '.png'), animations: 'disabled' });
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
  await page.route('**/api/bookmarks/*/*', (route) => route.fulfill({ json: [
    {
      id: 'clip-memo', folder: '문서', filename: '예제.pdf', pageIndex: 8, comment: '메모에 입력한 검색 예제',
      imageUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
      borderColor: '#444444', createdAt: '2026-11-23T00:00:00Z',
    },
  ] }));
  await page.goto(base);
  await page.getByTestId('lnb-search-input').fill(query);
  await page.getByTestId('lnb-search-input').press('Enter');
  await page.getByTestId('search-result-count').waitFor();
  assert.equal(await page.getByRole('tab', { name: '제목' }).getAttribute('aria-selected'), 'true');
  assert.deepEqual(requests, [['/api/search/books', query]]);
  await screenshot(page, '01-default-title');

  for (const [label, scope, snippet, pageNumber] of scopes) {
    const count = requests.length;
    await page.getByRole('tab', { name: label, exact: true }).click();
    const panel = page.getByRole('tabpanel', { name: label });
    await panel.getByText(snippet, { exact: true }).waitFor();
    assert.match(await panel.getByRole('link', { name: '예제.pdf' }).getAttribute('href'), new RegExp('page=' + pageNumber + '$'));
    assert.equal(new URL(page.url()).searchParams.get('scope'), scope);
    assert.deepEqual(requests.slice(count), [['/api/search/content/' + scope, query]]);
    await screenshot(page, '02-' + scope);
  }

  await page.getByRole('button', { name: '클립 열기' }).click();
  const clip = page.getByTestId('bookmark-preview-dialog');
  await clip.getByRole('textbox', { name: '메모' }).waitFor();
  assert.equal(await clip.getByRole('textbox', { name: '메모' }).inputValue(), '메모에 입력한 검색 예제');
  await screenshot(page, '03-clip-preview');
  await clip.getByRole('button', { name: '닫기' }).click();
  await page.getByTestId('book-clips-dialog').getByRole('button', { name: '닫기' }).click();

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
  await mobile.waitForFunction(() => {
    const tabList = document.querySelector('[role="tablist"]');
    const selected = tabList?.querySelector('[aria-selected="true"]');
    if (!selected) return false;
    const scroller = tabList.parentElement.getBoundingClientRect();
    const tab = selected.getBoundingClientRect();
    return tab.left >= scroller.left - 1 && tab.right <= scroller.right + 1;
  });
  await screenshot(mobile, '04-mobile-clip-memo');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ requests, errors, output }));
} finally {
  await browser.close();
}
