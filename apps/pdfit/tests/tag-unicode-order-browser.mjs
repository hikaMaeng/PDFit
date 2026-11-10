import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// LNB 태그는 이름의 유니코드(UTF-16 코드 유닛) 순으로만 정렬되어야 한다.
// 서점 분류 그룹(데이터베이스·프로그래밍·마케팅 …)이나 로케일 정렬이 섞이면 실패한다.
const baseUrl = process.env.PDFIT_TEST_BASE_URL ?? 'http://localhost:15203';
const executablePath = process.env.PDFIT_TEST_CHROMIUM_PATH || undefined;
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
const output = path.join(testDirectory, '..', '..', '..', 'test', stamp, 'tag-unicode-order');
await mkdir(output, { recursive: true });

// 스크린샷 사례 + 대소문자·기호·한글 혼합. 서버가 돌려주는 순서는 일부러 뒤섞는다.
const names = [
  '데이터베이스', '프로그래밍', '마케팅', '디자인', '역사', '소설', '건강', '과학', '자기계발',
  '3D그래픽', 'AI', 'API', 'AWS', 'Android', 'C++', 'CSS', 'C언어', 'DDD', 'Docker', 'Elasticsearch', 'Figma',
  'UI·UX', '경제·경영', 'iOS', 'abc',
];
const tags = names.map((name, index) => ({ name, bookCount: index + 1, color: '#3b82f6' }));
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const expected = [...names].sort(compare);

const errors = [];
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1380, height: 900 } });
page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
await page.addInitScript(() => {
  localStorage.setItem('pdfit.language', 'ko');
  localStorage.setItem('pdfit.color-mode', 'dark');
});
await page.route('**/api/**', async (route) => {
  const { pathname } = new URL(route.request().url());
  if (pathname === '/api/events') {
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: ready\n\n' });
    return;
  }
  const json = pathname === '/api/folders'
    ? [{ name: 'PDFit Library', pdfCount: 0, createdAt: '2026-09-14T05:00:00.000Z', isRoot: true, color: '#3b82f6' }]
    : pathname === '/api/tags/summary' ? tags
      : pathname.startsWith('/api/tags/folder/') ? {}
        : pathname.startsWith('/api/progress/') ? null
          : [];
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
});
await page.goto(`${baseUrl}/folder/PDFit%20Library`, { waitUntil: 'networkidle' });

const rows = page.locator('.pdfit-tag-row');
await rows.first().waitFor({ state: 'visible' });
assert.equal(await rows.count(), tags.length, '태그가 누락되거나 중복 렌더링됨');
const actual = await rows.locator('.MuiListItemText-root').evaluateAll((items) => items.map((item) => (item.textContent ?? '').replace(/^#\s*/, '').replace(/\d+$/, '').trim()));
await page.screenshot({ path: path.join(output, 'lnb-tags.png'), fullPage: true });
await writeFile(path.join(output, 'result.json'), JSON.stringify({ baseUrl, input: names, actual, expected }, null, 2), 'utf8');

assert.deepEqual(actual, expected, `태그가 유니코드 순이 아님: ${actual.join(', ')}`);
assert.ok(actual.indexOf('3D그래픽') < actual.indexOf('AI'), '숫자가 영문보다 앞서지 않음');
assert.ok(actual.indexOf('AWS') < actual.indexOf('Android'), '대문자가 소문자보다 앞서지 않음');
assert.ok(actual.indexOf('Figma') < actual.indexOf('abc') && actual.indexOf('abc') < actual.indexOf('건강'), '영문 소문자가 한글보다 앞서지 않음');
assert.ok(actual.indexOf('건강') < actual.indexOf('데이터베이스') && actual.indexOf('데이터베이스') < actual.indexOf('프로그래밍'), '한글이 가나다순이 아님');
await browser.close();
assert.deepEqual(errors, []);
console.log(`PASS unicode-tag-order tags=${actual.length} first=${actual[0]} last=${actual.at(-1)} output=${output}`);
