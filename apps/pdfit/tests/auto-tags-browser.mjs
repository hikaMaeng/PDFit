import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// 태그 페이지가 책의 모든 태그(그 페이지 자신의 태그 포함)를 목록·표지 보기에 보이는지 배포된 Free 서버에서 검증한다.
// 계약: CHANGELOG.md Unreleased "A tag page's cards and rows show every tag of a book, including the page's own tag."
// 기대값은 화면 코드가 아니라 `GET /api/tags/:tag/books`의 그 책 `tags`에서 가져온다. 이 테스트는 아무것도 쓰지 않는다.
const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const tagName = process.env.PDFIT_TEST_TAG ?? '인공지능';
const filename = process.env.PDFIT_TEST_FILE ?? 'AI 엔지니어링.pdf';
const channel = process.env.PDFIT_TEST_CHANNEL ?? 'chrome';
const runId = process.env.PDFIT_TEST_RUN ?? '20261112_auto-tags';
const output = new URL(`./reports/auto-tags/${runId}/`, import.meta.url);
await mkdir(output, { recursive: true });
const shot = (name) => decodeURIComponent(new URL(name, output).pathname.slice(1));

const books = await (await fetch(`${origin}/api/tags/${encodeURIComponent(tagName)}/books`)).json();
const book = books.find((candidate) => candidate.filename === filename);
assert.ok(book, `${filename} is tagged ${tagName}`);
const expected = [...book.tags].sort();
const result = { runId, origin, tagName, filename, apiTags: book.tags, steps: [], pageErrors: [], writes: [] };

const browser = await chromium.launch({ channel, headless: true });
try {
  for (const viewport of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 375, height: 812 }]) {
    const context = await browser.newContext({ locale: 'ko-KR', viewport, colorScheme: 'dark' });
    await context.addInitScript(() => { try { localStorage.setItem('pdfit.language', 'ko'); } catch {} });
    const page = await context.newPage();
    page.on('pageerror', (error) => result.pageErrors.push(String(error)));
    page.on('request', (request) => { if (!['GET', 'HEAD'].includes(request.method()) && !request.url().includes('/api/settings/translations')) result.writes.push(`${request.method()} ${new URL(request.url()).pathname}`); });
    await page.goto(`${origin}/tag/${encodeURIComponent(tagName)}`, { waitUntil: 'domcontentloaded' });
    // Display-name translation POSTs can stay open for minutes, so the page never goes network-idle.
    await page.getByRole('button', { name: '목록 보기' }).waitFor({ timeout: 30_000 });

    // At 375 px the list row is already broken on every list page (filename column collapses, chips lose
    // their text; also on /tag/3D그래픽 and /search), so the mobile pass checks the cover view only.
    for (const view of viewport.name === 'mobile' ? ['표지 보기'] : ['목록 보기', '표지 보기']) {
      await page.getByRole('button', { name: view }).click();
      // The list row renders tags twice (narrow and wide layouts) and hides one; the cover card shows them on hover.
      if (view === '표지 보기') await page.locator('[data-testid="pdf-cover-card"]').first().hover();
      const visibleChips = page.locator('[data-testid="pdf-tag-chip"]:visible');
      await visibleChips.first().waitFor({ timeout: 15_000 }).catch(async (error) => { await page.screenshot({ path: shot(`${viewport.name}-failure.png`) }); throw error; });
      const chips = (await visibleChips.allTextContents()).map((text) => text.replace(/^#/, '').trim());
      const step = { viewport: viewport.name, view, chips, matchesApi: JSON.stringify([...chips].sort()) === JSON.stringify(expected), includesPageTag: chips.includes(tagName) };
      result.steps.push(step);
      await page.screenshot({ path: shot(`${viewport.name}-${view === '목록 보기' ? 'list' : 'cover'}.png`) });
      if (viewport.name === 'mobile') step.horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    }
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(new URL('result.json', output), JSON.stringify(result, null, 2));
}

for (const step of result.steps) {
  assert.ok(step.matchesApi, `${step.viewport} ${step.view}: chips ${step.chips} = API ${expected}`);
  assert.ok(step.includesPageTag, `${step.viewport} ${step.view}: page tag shown`);
  if (step.horizontalOverflow !== undefined) assert.ok(step.horizontalOverflow <= 0, 'no horizontal overflow at 375 px');
}
assert.deepEqual(result.pageErrors, []);
assert.deepEqual(result.writes, [], 'the test writes nothing');
console.log(JSON.stringify(result, null, 2));
