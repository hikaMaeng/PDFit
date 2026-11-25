import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.PDFIT_TEST_ORIGIN;
if (!origin) throw new Error('Set PDFIT_TEST_ORIGIN to the disposable list mode fixture.');
const artifacts = path.resolve(process.env.PDFIT_TEST_ARTIFACT_DIR ?? 'test/library-list-mode-browser');
await mkdir(artifacts, { recursive: true });

const folder = 'Fixture';
const filename = 'List feature specimen.pdf';
const renamed = `List feature renamed ${randomUUID().slice(0, 8)}.pdf`;
const longFilename = 'Reference volume with a deliberately long filename for desktop and mobile.pdf';
const tag = 'Library list tag';
const aiTag = 'Library AI tag';
const comment = `리스트에서 남긴 코멘트 ${randomUUID()}`;
const bookRoute = `/api/tags/book/${folder}/${encodeURIComponent(filename)}`;
const actionsLabel = 'PDF 작업';
const expectedActions = ['코멘트', '클립 보기', '실제 책 표지로 바꾸기', '다른 폴더로 이동', '삭제'];
const browser = await chromium.launch();
const desktop = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 820 }, locale: 'ko-KR' });
const phone = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR' });
const page = await desktop.newPage();
const mobile = await phone.newPage();
desktop.setDefaultTimeout(10_000);
phone.setDefaultTimeout(10_000);
const errors = [];

for (const context of [desktop, phone]) {
  await context.addInitScript(() => {
    localStorage.setItem('pdfit.language', 'ko');
    localStorage.setItem('pdfit.library.view', 'list');
    localStorage.setItem('pdfit.color-mode', 'dark');
  });
}
for (const tab of [page, mobile]) tab.on('pageerror', (error) => errors.push(error.message));
await desktop.tracing.start({ screenshots: true, snapshots: true });

const openButton = (scope, name) => scope.getByRole('button', { name, exact: true });
const row = (tab, name = filename) => tab.getByRole('listitem').filter({ has: tab.getByRole('link', { name, exact: true }) });
const card = (name = filename) => page.getByTestId('pdf-cover-card').filter({ has: page.getByRole('link', { name, exact: true }) });
const dialog = () => page.getByRole('dialog');
const toggle = (name) => openButton(page, name).click();
const screenshot = (tab, name) => tab.screenshot({ path: path.join(artifacts, `${name}.png`), animations: 'disabled' });

async function request(route, method = 'GET', data) {
  const response = await desktop.request.fetch(route, { method, data });
  assert.ok(response.ok(), `${method} ${route} ${response.status()} ${await response.text()}`);
  return response;
}

async function thumbnail(container) {
  const image = container.locator('[data-testid="pdf-cover-thumbnail"][data-cover-state="ready"] img');
  await image.waitFor({ state: 'visible', timeout: 30_000 });
  return image.evaluate(async (element) => { await element.decode(); return element.currentSrc; });
}

async function verifyList(tab, compact) {
  const book = row(tab);
  await book.getByRole('link', { name: filename, exact: true }).waitFor();
  assert.deepEqual(await tab.getByTestId('pdf-list-header').locator('span').allTextContents(), ['파일명', '파일 크기']);
  assert.match(await book.getByTestId('pdf-file-size').innerText(), /\d+(\.\d+)? (B|KB|MB)/);
  assert.equal(await book.getByTestId('pdf-filename-line').getByRole('button').count(), 2);
  const fileActions = book.getByRole('group', { name: actionsLabel, exact: true });
  await openButton(fileActions, expectedActions[2]).waitFor();
  assert.deepEqual(await fileActions.getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))), expectedActions);
  const chip = book.getByTestId('pdf-tag-chip').filter({ hasText: tag });
  assert.equal(await chip.innerText(), tag);
  assert.equal(await chip.locator('svg[data-tag-icon]').getAttribute('data-tag-icon'), 'robot');
  const tagActions = book.getByTestId('pdf-tag-actions');
  assert.deepEqual(await tagActions.getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))), ['AI 자동 태그', '태그관리']);
  const layout = await book.evaluate((element) => {
    const r = (selector) => element.querySelector(selector).getBoundingClientRect().toJSON();
    const heading = document.querySelector('[data-testid="pdf-file-size-header"]').getBoundingClientRect();
    return { row: element.getBoundingClientRect().toJSON(), cover: r('[data-testid="pdf-cover-thumbnail"]'), name: r('[data-testid="pdf-filename-line"]'),
      tags: r('[data-testid="pdf-tag-values"]'), size: r('[data-testid="pdf-file-size"]'), actions: r('[role="group"]'),
      sizeHeadingX: heading.x, viewport: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth };
  });
  assert.ok(layout.cover.height >= layout.row.height - 10, JSON.stringify(layout));
  assert.ok(layout.cover.right < layout.name.left && layout.name.right < layout.size.left, JSON.stringify(layout));
  assert.ok(layout.tags.top >= layout.name.bottom - 1 && Math.abs(layout.size.x - layout.sizeHeadingX) < 2, JSON.stringify(layout));
  assert.ok(compact ? layout.actions.top >= layout.tags.bottom : layout.actions.left >= layout.size.right, JSON.stringify(layout));
  assert.ok(layout.scrollWidth <= layout.viewport + 1, JSON.stringify(layout));
}

try {
  const folders = await (await request('/api/folders')).json();
  assert.ok(folders.some((item) => item.isRoot && item.name === 'List mode test library'), 'Use the disposable List mode test library.');
  await request(bookRoute, 'POST', { tag });
  const summaries = await (await request('/api/tags/summary')).json();
  const summary = summaries.find((item) => item.name === tag);
  await request(`/api/tags/${summary.id}/details`, 'PATCH', { previousName: tag, icon: 'robot', color: '#00b66c' });

  await page.goto(`/folder/${folder}`);
  await verifyList(page, false);
  const originalThumbnail = await thumbnail(row(page));
  await screenshot(page, '01-folder-desktop');
  await row(page).getByTestId('pdf-selection-checkbox').check();
  assert.equal(await row(page).getByTestId('pdf-selection-checkbox').isChecked(), true);
  await row(page).getByTestId('pdf-selection-checkbox').uncheck();

  await mobile.goto(`/folder/${folder}`);
  await verifyList(mobile, true);
  await row(mobile, longFilename).getByRole('link', { name: longFilename, exact: true }).waitFor();
  await screenshot(mobile, '02-folder-phone');

  const addFavorite = openButton(row(page), '즐겨찾기에 추가');
  if (await addFavorite.isVisible()) await addFavorite.click();
  await openButton(row(page), '즐겨찾기에서 제거').waitFor();
  await openButton(row(page), '코멘트').click();
  await openButton(dialog(), '새 코멘트').click();
  await dialog().getByRole('textbox', { name: '코멘트 본문' }).fill(comment);
  await openButton(dialog(), '저장').click();
  await dialog().getByText(comment, { exact: true }).waitFor();
  await openButton(dialog(), '닫기').click();
  await openButton(row(page), '클립 보기').click();
  await openButton(dialog(), '닫기').click();
  await openButton(row(page), '태그관리').click();
  await dialog().getByText(tag, { exact: false }).last().waitFor();
  await openButton(dialog(), '닫기').click();
  await dialog().waitFor({ state: 'hidden' });

  let aiRequests = 0;
  await page.route(`**${bookRoute}/auto`, async (route) => {
    assert.equal(route.request().method(), 'POST');
    aiRequests += 1;
    await route.fulfill({ json: { addedTags: [aiTag], removedTags: [] } });
  });
  await openButton(row(page), 'AI 자동 태그').click();
  await row(page).getByTestId('pdf-tag-chip').filter({ hasText: aiTag }).waitFor();
  assert.equal(aiRequests, 1);

  await page.route('**/api/covers/candidates?*', (route) => route.fulfill({ json: { candidates: [], failedSources: [] } }));
  await openButton(row(page), expectedActions[2]).click();
  await dialog().getByRole('textbox').waitFor();
  assert.equal(await dialog().getByRole('textbox').inputValue(), 'List feature specimen');
  await openButton(dialog(), '닫기').click();

  await toggle('표지 보기');
  assert.equal(await thumbnail(card()), originalThumbnail);
  await openButton(card(), '즐겨찾기에서 제거').waitFor();
  await openButton(card(), '코멘트').click();
  await dialog().getByText(comment, { exact: true }).waitFor();
  await openButton(dialog(), '닫기').click();
  await openButton(card(), expectedActions[2]).click();
  assert.equal(await dialog().getByRole('textbox').inputValue(), 'List feature specimen');
  await openButton(dialog(), '닫기').click();
  await screenshot(page, '03-folder-covers');
  await toggle('목록 보기');

  await page.goto(`/tag/${encodeURIComponent(tag)}`);
  await verifyList(page, false);
  await screenshot(page, '04-tag-desktop');
  await page.goto('/search?q=List%20feature');
  await verifyList(page, false);
  await row(page).getByTestId('pdf-folder-location').waitFor();
  await screenshot(page, '05-search-desktop');

  await page.goto(`/folder/${folder}`);
  await openButton(row(page), '파일 이름 바꾸기').click();
  await dialog().getByRole('textbox', { name: '파일 이름' }).fill(renamed);
  await openButton(dialog(), '저장').click();
  await thumbnail(row(page, renamed));
  await openButton(row(page, renamed), expectedActions[3]).click();
  await dialog().getByRole('radio', { name: 'Destination', exact: true }).click();
  await openButton(dialog(), '이동').click();
  await row(page, renamed).waitFor({ state: 'hidden' });
  await page.goto('/folder/Destination');
  await thumbnail(row(page, renamed));
  await openButton(row(page, renamed), expectedActions[4]).click();
  await openButton(dialog(), '삭제').click();
  await row(page, renamed).waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  console.log('List layout, shared controls, and fixture rename, move, and delete passed.');
} catch (error) {
  await screenshot(page, 'failure-desktop').catch(() => undefined);
  throw error;
} finally {
  await desktop.tracing.stop({ path: path.join(artifacts, 'trace.zip') });
  await browser.close();
}
