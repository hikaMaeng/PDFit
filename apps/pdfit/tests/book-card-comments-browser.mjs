import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const origin = process.env.PDFIT_TEST_ORIGIN;
if (!origin) throw new Error('Set PDFIT_TEST_ORIGIN to a disposable Free instance.');
const artifacts = path.resolve(process.env.PDFIT_TEST_ARTIFACT_DIR ?? 'test/book-card-comments-browser');
await mkdir(artifacts, { recursive: true });
const folder = process.env.PDFIT_TEST_FIXTURE_FOLDER ?? 'Fixture';
const destination = process.env.PDFIT_TEST_DESTINATION_FOLDER ?? 'Destination';
const original = 'Card fixture.pdf';
const conflict = 'Existing name.pdf';
const renamed = 'Renamed card.pdf';
const tag = 'Verification tag';
const ref = (name, parent = folder) => `${encodeURIComponent(parent)}/${encodeURIComponent(name)}`;
const file = (name, parent = folder) => `/api/folders/${encodeURIComponent(parent)}/files/${encodeURIComponent(name)}`;
const comments = (name, parent = folder) => `/api/book-comments?${new URLSearchParams({ folder: parent, filename: name })}`;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const browser = await chromium.launch();
const context = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 850 }, locale: 'ko-KR' });
const page = await context.newPage();
const exceptions = [];
page.on('pageerror', (error) => exceptions.push(error.message));
await context.tracing.start({ screenshots: true, snapshots: true });

const fetch = async (route, method = 'GET', data, expected = 200) => {
  const response = await context.request.fetch(route, { method, data });
  assert.equal(response.status(), expected, `${method} ${route}: ${await response.text()}`);
  return response;
};

const card = (name) => page.getByTestId('pdf-cover-card').filter({ has: page.getByRole('link', { name, exact: true }) });
const board = page.getByRole('dialog').filter({ hasText: '코멘트' });
const articles = board.getByRole('article');
const action = (name, scope = page) => scope.getByRole('button', { name, exact: true });
const mustSee = (text, scope = page) => scope.getByText(text, { exact: true }).waitFor({ state: 'visible' });
const written = Array.from({ length: 6 }, (_, index) => `${index + 1}번째 독서 메모`);
const longBody = [written[1], ...Array.from({ length: 80 }, (_, index) => `${index + 1}번째 줄에 적은 내용`)].join('\n');

async function post(body, displayed = body) {
  await action('새 코멘트', board).click();
  await board.getByRole('textbox', { name: '코멘트 본문' }).fill(body);
  await action('저장', board).click();
  await board.getByText(displayed, { exact: body === displayed }).waitFor({ state: 'visible' });
}

async function verifyLayout(browserPage, dialog) {
  const content = dialog.getByTestId('book-comments-content');
  const footer = action('새 코멘트', dialog);
  const header = action('닫기', dialog);
  const viewport = browserPage.viewportSize();
  const box = await dialog.boundingBox();
  assert.ok(box.width > viewport.width * .9 && box.width <= viewport.width, 'dialog fills the available width');
  assert.ok(box.height > viewport.height * .88 && box.y >= 0 && box.y + box.height <= viewport.height + 1, 'dialog fits the available height');
  const before = [(await header.boundingBox()).y, (await footer.boundingBox()).y];
  const scrollTop = await content.evaluate((element) => {
    if (element.scrollHeight <= element.clientHeight || element.scrollWidth > element.clientWidth) {
      throw new Error('Expected only vertical overflow in the comment content');
    }
    element.scrollTop = element.scrollHeight;
    return element.scrollTop;
  });
  assert.ok(scrollTop > 0);
  assert.deepEqual([(await header.boundingBox()).y, (await footer.boundingBox()).y], before);
}

try {
  const folders = await (await fetch('/api/folders')).json();
  assert.ok(folders.some((item) => item.isRoot && item.name === 'Comment test library'), 'This scenario requires the disposable book-card fixture library.');
  const sourceHash = digest(await (await fetch(file(original))).body());
  const existingHash = digest(await (await fetch(file(conflict))).body());
  const state = { page: 2, scale: 1.15, fitMode: 'width', viewMode: 'scroll', inverted: false, uiHidden: false, scrollTop: 55 };
  await fetch(`/api/tags/book/${ref(original)}`, 'POST', { tag });
  await fetch(`/api/favorites/${ref(original)}`, 'PUT');
  await fetch(`/api/viewer-state/${ref(original)}`, 'PUT', state);
  const image = await sharp({ create: { width: 12, height: 12, channels: 3, background: '#f7ede2' } }).png().toBuffer();
  const clip = await (await fetch(`/api/bookmarks/${ref(original)}`, 'POST', {
    pageIndex: 0, rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, borderColor: '#f59e0b',
    comment: 'Clip fixture memo', imageMimeType: 'image/png',
    imageBase64: image.toString('base64'),
  }, 201)).json();

  await page.addInitScript(() => {
    localStorage.setItem('pdfit.language', 'ko');
    localStorage.setItem('pdfit.library.view', 'covers');
  });
  await page.goto(`/folder/${encodeURIComponent(folder)}`);
  const source = card(original);
  const bar = source.getByTestId('pdf-cover-actions');
  await action('코멘트', bar).waitFor();
  assert.equal(await bar.getByRole('button').first().getAttribute('aria-label'), '코멘트');
  assert.equal(await action('파일 자동 분류', bar).count(), 0);
  await source.getByTestId('pdf-cover-media').hover();
  const tagArea = source.getByTestId('pdf-cover-tags');
  const autoTag = action('파일 자동 분류', tagArea);
  await autoTag.waitFor();
  assert.equal(await tagArea.getByRole('button').last().getAttribute('aria-label'), '파일 자동 분류');
  assert.equal(await tagArea.getByText(tag, { exact: false }).count(), 1);
  await source.getByTestId('pdf-cover-thumbnail').and(page.locator('[data-cover-state="ready"]')).waitFor();
  await page.screenshot({ path: path.join(artifacts, '01-book-card.png'), animations: 'disabled' });

  await source.getByTestId('pdf-cover-clips').click();
  const clips = page.getByTestId('book-clips-dialog');
  await clips.waitFor();
  await action('닫기', clips).click();
  await action('코멘트', bar).click();
  await mustSee('이 책에 남긴 코멘트가 없습니다.', board);
  await post(written[0]);
  await post(longBody, written[1]);
  for (const entry of written.slice(2)) await post(entry);
  await mustSee('1 / 2', board);
  assert.equal(await articles.count(), 5);
  assert.deepEqual(await articles.getByText(/^[3-6]번째 독서 메모$/).allTextContents(), written.slice(2).reverse());
  assert.equal(await board.getByText(written[0], { exact: true }).count(), 0);
  await page.screenshot({ path: path.join(artifacts, '02-comments-page.png'), animations: 'disabled' });
  await verifyLayout(page, board);
  await page.setViewportSize({ width: 900, height: 620 });
  await verifyLayout(page, board);
  await page.setViewportSize({ width: 1280, height: 850 });
  await action('다음 페이지', board).click();
  await mustSee(written[0], board);
  assert.equal(await articles.count(), 1);
  assert.equal(await board.getByTestId('book-comments-content').evaluate((element) => element.scrollTop), 0);
  await action('수정', articles.first()).click();
  await board.getByRole('textbox', { name: '코멘트 본문' }).fill('첫 번째 독서 메모 수정');
  await action('저장', board).click();
  await mustSee('첫 번째 독서 메모 수정', board);
  await mustSee('2 / 2', board);
  await action('새 코멘트', board).and(page.locator(':enabled')).waitFor();
  await action('닫기', board).click();
  await action('코멘트', card(conflict)).click();
  await mustSee('이 책에 남긴 코멘트가 없습니다.', board);
  const foreignId = (await (await fetch(comments(original))).json()).comments[0].id;
  await fetch(`${comments(conflict)}&id=${foreignId}`, 'PATCH', { body: 'Wrong book' }, 404);
  await fetch(`${comments(original)}&id=${randomUUID()}`, 'POST', { body: '  ' }, 400);
  await action('닫기', board).click();

  await action('파일 작업', bar).click();
  const menu = page.getByRole('menu');
  await menu.getByRole('menuitem', { name: '파일 이름 바꾸기' }).waitFor();
  assert.equal(await menu.getByRole('menuitem', { name: '다른 폴더로 이동' }).count(), 1);
  assert.equal(await menu.getByRole('menuitem', { name: '삭제', exact: true }).count(), 1);
  await page.screenshot({ path: path.join(artifacts, '03-file-menu.png'), animations: 'disabled' });
  await menu.getByRole('menuitem', { name: '파일 이름 바꾸기' }).click();
  const rename = page.getByRole('dialog', { name: '파일 이름 바꾸기' });
  const input = rename.getByRole('textbox', { name: '파일 이름' });
  await input.fill('bad/name');
  assert.equal(await action('저장', rename).isDisabled(), true);
  await input.fill(conflict);
  await action('저장', rename).click();
  await mustSee('같은 이름의 파일이 이 폴더에 이미 있습니다.', rename);
  assert.equal(digest(await (await fetch(file(conflict))).body()), existingHash);
  assert.equal(digest(await (await fetch(file(original))).body()), sourceHash);
  await input.fill('Renamed card');
  await action('저장', rename).click();
  await card(renamed).waitFor();
  await fetch(file(original), 'GET', undefined, 404);
  assert.equal(digest(await (await fetch(file(renamed))).body()), sourceHash);
  assert.equal((await (await fetch(`/api/viewer-state/${ref(renamed)}`)).json()).page, state.page);
  assert.deepEqual(await (await fetch(`/api/tags/book/${ref(renamed)}`)).json(), [tag]);
  assert.ok((await (await fetch('/api/favorites')).json()).some((item) => item.filename === renamed));
  const clipsAfterRename = await (await fetch(`/api/bookmarks/${ref(renamed)}`)).json();
  assert.deepEqual(clipsAfterRename.map(({ id, comment }) => [id, comment]), [[clip.id, 'Clip fixture memo']]);
  assert.equal(await card(renamed).getByTestId('pdf-cover-clips').getAttribute('data-clip-graphic'), '1');

  await page.reload();
  await action('코멘트', card(renamed)).click();
  await mustSee(written[5], board);
  await action('삭제', articles.filter({ hasText: written[5] })).click();
  await mustSee('이 코멘트를 삭제할까요?', board);
  await action('삭제', board).click();
  await mustSee('첫 번째 독서 메모 수정', board);
  await mustSee('1 / 1', board);
  assert.equal(await articles.count(), 5);
  assert.equal(await board.getByText(written[5], { exact: true }).count(), 0);
  await action('닫기', board).click();

  await action('파일 작업', card(renamed)).click();
  await menu.getByRole('menuitem', { name: '다른 폴더로 이동' }).click();
  const move = page.getByRole('dialog').filter({ hasText: '다른 폴더로 이동' });
  await move.getByRole('radio', { name: destination, exact: true }).click();
  await action('이동', move).click();
  await card(renamed).waitFor({ state: 'hidden' });
  await page.goto(`/folder/${encodeURIComponent(destination)}`);
  await action('코멘트', card(renamed)).click();
  await mustSee('첫 번째 독서 메모 수정', board);
  assert.equal(digest(await (await fetch(file(renamed, destination))).body()), sourceHash);
  await action('닫기', board).click();
  await action('파일 작업', card(renamed)).click();
  await menu.getByRole('menuitem', { name: '삭제', exact: true }).click();
  const deletion = page.getByRole('dialog');
  await action('취소', deletion).click();
  await card(renamed).waitFor();
  assert.equal(exceptions.length, 0, exceptions.join('\n'));

  const touch = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR' });
  await touch.addInitScript(() => { localStorage.setItem('pdfit.language', 'ko'); localStorage.setItem('pdfit.library.view', 'covers'); });
  const mobile = await touch.newPage();
  await mobile.goto(`/folder/${encodeURIComponent(destination)}`);
  const mobileCard = mobile.getByTestId('pdf-cover-card');
  await action('문서 정보 보기', mobileCard).tap();
  await action('파일 자동 분류', mobileCard.getByTestId('pdf-cover-tags')).waitFor();
  await action('코멘트', mobileCard).tap();
  await mustSee('첫 번째 독서 메모 수정', mobile.getByRole('dialog'));
  await mobile.screenshot({ path: path.join(artifacts, '04-comments-touch.png'), animations: 'disabled' });
  await verifyLayout(mobile, mobile.getByRole('dialog'));
  await touch.close();

  await action('파일 작업', card(renamed)).click();
  await menu.getByRole('menuitem', { name: '삭제', exact: true }).click();
  await action('삭제', deletion).click();
  await card(renamed).waitFor({ state: 'hidden' });
  assert.equal((await (await fetch(comments(renamed, destination))).json()).total, 0);
  console.log('PASS five posts per page, responsive scrolling, isolated comments, rename, collision, move and delete');
} catch (error) {
  await page.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => undefined);
  throw error;
} finally {
  await context.tracing.stop({ path: path.join(artifacts, 'trace.zip') });
  await browser.close();
}
