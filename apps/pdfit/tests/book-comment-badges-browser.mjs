import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.PDFIT_TEST_ORIGIN;
if (!origin) throw new Error('Set PDFIT_TEST_ORIGIN to the disposable Free fixture.');
const artifacts = path.resolve(process.env.PDFIT_TEST_ARTIFACT_DIR ?? 'test/book-comment-badges-browser');
await mkdir(artifacts, { recursive: true });
const folder = 'Badges';
const filename = 'Badge count.pdf';
const emptyFilename = 'Empty count.pdf';
const countRoute = '/api/book-comments/counts';
const commentRoute = `/api/book-comments?${new URLSearchParams({ folder, filename })}`;
const browser = await chromium.launch();
const context = await browser.newContext({ baseURL: origin, viewport: { width: 1150, height: 800 }, locale: 'ko-KR' });
const page = await context.newPage();
const mirror = await context.newPage();
await mirror.emulateMedia({ colorScheme: 'dark' });
const exceptions = [];
for (const tab of [page, mirror]) tab.on('pageerror', (error) => exceptions.push(error.message));
await context.tracing.start({ screenshots: true, snapshots: true });

const button = (tab, name = filename) => tab.getByTestId('pdf-cover-card')
  .filter({ has: tab.getByRole('link', { name, exact: true }) }).getByRole('button', { name: '코멘트', exact: true });
const board = page.getByRole('dialog').filter({ hasText: '코멘트' });
const action = (name, scope = board) => scope.getByRole('button', { name, exact: true });
const graphicFor = async (tab, count, name) => {
  const target = button(tab, name).and(tab.locator(`[aria-description="코멘트 ${count}개"]`));
  const graphic = target.locator('img');
  await graphic.waitFor({ state: 'visible' });
  return graphic.evaluate(async (element) => {
    await element.decode();
    return (await fetch(element.currentSrc)).text();
  });
};

try {
  const folders = await (await context.request.get('/api/folders')).json();
  assert.ok(folders.some((item) => item.isRoot && item.name === 'Comment test library'), 'Use a disposable Comment test library.');
  assert.equal((await (await context.request.get(commentRoute)).json()).total, 0, 'Start with a fresh fixture.');
  const seed = await context.request.post(`${commentRoute}&id=${randomUUID()}`, { data: { body: '테스트 시작 전에 저장한 코멘트' } });
  assert.equal(seed.status(), 201);
  await context.addInitScript(() => {
    localStorage.setItem('pdfit.language', 'ko');
    localStorage.setItem('pdfit.library.view', 'covers');
  });

  const loads = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === countRoute) loads.push(request.postDataJSON().books);
  });
  await page.goto('/folder/Badges');
  const zero = await graphicFor(page, 0, emptyFilename);
  const one = await graphicFor(page, 1);
  assert.match(zero, /#a9b8cb/i);
  assert.match(one, /#ffd353/i);
  assert.ok(loads.some((batch) => batch.some((book) => book.filename === filename) &&
    batch.some((book) => book.filename === emptyFilename)), 'The card counts share an initial request.');
  await page.screenshot({ path: path.join(artifacts, '01-zero-and-one.png'), animations: 'disabled' });

  await mirror.goto('/folder/Badges');
  await graphicFor(mirror, 1);
  await button(page).click();
  const graphics = new Set([zero, one]);
  for (let count = 2; count <= 10; count += 1) {
    const body = `Badge fixture ${count}`;
    await action('새 코멘트').click();
    await board.getByRole('textbox', { name: '코멘트 본문' }).fill(body);
    await action('저장').click();
    await board.getByText(body, { exact: true }).waitFor();
    const graphic = await graphicFor(mirror, count);
    assert.match(graphic, /#ffd353/i);
    assert.ok(!graphics.has(graphic), `Expected a distinct graphic at ${count}.`);
    graphics.add(graphic);
    if (count >= 9) {
      await mirror.screenshot({ path: path.join(artifacts, `0${count - 7}-count-${count}.png`), animations: 'disabled' });
    }
  }
  assert.equal(graphics.size, 11);
  await action('닫기').click();
  assert.equal(await graphicFor(page, 10), await graphicFor(mirror, 10));
  await button(page).hover();
  await page.getByRole('tooltip', { name: '코멘트 10개', exact: true }).waitFor();
  await mirror.reload();
  await graphicFor(mirror, 10);

  await button(page).click();
  await action('삭제', board.getByRole('article').filter({ hasText: 'Badge fixture 10' })).click();
  await action('삭제').click();
  await action('닫기').click();
  assert.equal(await graphicFor(page, 9), await graphicFor(mirror, 9));
  assert.equal(await graphicFor(page, 0, emptyFilename), zero);
  assert.deepEqual(exceptions, []);
  console.log('PASS eleven SVGs, zero/positive colors, initial batch, 9 to 9+, exact tooltip, reload and cross-tab create/delete');
} catch (error) {
  await page.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => undefined);
  throw error;
} finally {
  await context.tracing.stop({ path: path.join(artifacts, 'trace.zip') });
  await browser.close();
}
