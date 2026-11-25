import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.PDFIT_TEST_ORIGIN;
if (!origin) throw new Error('Set PDFIT_TEST_ORIGIN to the disposable viewer comments library.');
const artifacts = path.resolve(process.env.PDFIT_TEST_ARTIFACT_DIR ?? 'test/viewer-book-comments');
await mkdir(artifacts, { recursive: true });
const folder = 'Fixture';
const filename = 'Viewer comments.pdf';
const viewerPath = `/viewer/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`;
const commentPath = `/api/book-comments?${new URLSearchParams({ folder, filename })}`;
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader'] });
const desktop = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 850 }, locale: 'ko-KR' });
const errors = [];
const titles = Array.from({ length: 6 }, (_, index) => `Example reading note ${index + 1}`);
const noteTitle = 'Written from the PDFGPU viewer';
const viewerNote = [
  '    firstLine()',
  '',
  `## ${noteTitle}`,
  '',
  '**Bold** and *italic* with ~~old text~~ and `inline()`.',
  '> Quoted passage',
  '',
  '- [x] Done',
  '- [ ] Next step',
  '',
  '| Page | Topic |',
  '| ---: | --- |',
  '| 12 | Example |',
  '',
  '```js',
  `console.log('${'wide-code-'.repeat(16)}');`,
  '```',
  '',
  '[Reference](https://example.com/) and [Invalid URL](javascript:void(0)).',
  '<span data-comment-raw>Raw HTML example</span>',
  '',
  '![PDFit icon](/brand/pdfit-favicon.png)',
  '',
  'A note[^source].',
  '',
  '[^source]: Edition details.',
].join('\n');
const editedNote = `${viewerNote.replace('Quoted passage', 'Edited passage')}\n\n`;
const seedNotes = titles.map((title, index) => index === 1
  ? [title, ...Array.from({ length: 45 }, (_, detail) => `Detail ${detail + 1}`)].join('\n') : title);

function controls(page) { return page.getByRole('toolbar', { name: 'viewer controls' }); }
function toggle(page) { return controls(page).getByRole('button', { name: '코멘트', exact: true }); }
function panel(page) { return page.getByRole('dialog', { name: '코멘트', exact: true }); }
function panelText(page, text) { return panel(page).getByText(text, { exact: true }); }
function markdownPost(page) {
  return panel(page).getByRole('article').filter({ has: page.getByRole('heading', { name: noteTitle, exact: true }) });
}
function editor(page) { return panel(page).getByRole('textbox', { name: '코멘트 본문' }); }
async function assertMarkdown(page, quote) {
  const post = markdownPost(page);
  await post.getByRole('heading', { name: noteTitle, exact: true }).waitFor();
  await post.getByRole('table').getByRole('columnheader', { name: 'Topic' }).waitFor();
  await post.getByRole('cell', { name: 'Example', exact: true }).waitFor();
  assert.equal(await post.locator('strong').textContent(), 'Bold');
  assert.equal(await post.locator('em').textContent(), 'italic');
  assert.equal(await post.locator('del').textContent(), 'old text');
  assert.equal(await post.locator('blockquote').innerText(), quote);
  assert.equal(await post.getByRole('checkbox').first().isChecked(), true);
  assert.equal(await post.getByRole('checkbox').last().isChecked(), false);
  assert.equal(await post.getByRole('checkbox').first().isDisabled(), true);
  assert.equal(await post.getByRole('link', { name: 'Reference', exact: true }).getAttribute('href'), 'https://example.com/');
  assert.equal(await post.getByText('Invalid URL', { exact: true }).getAttribute('href'), null);
  assert.equal(await post.locator('[data-comment-raw]').count(), 0);
  assert.match(await post.innerText(), /<span data-comment-raw>Raw HTML example<\/span>/);
  assert.equal(await post.getByRole('img', { name: 'PDFit icon', exact: true }).getAttribute('src'), '/brand/pdfit-favicon.png');
  const reference = post.getByRole('link', { name: '1', exact: true });
  const label = post.getByRole('heading', { name: '각주', exact: true });
  assert.equal(await reference.getAttribute('aria-describedby'), await label.getAttribute('id'));
  assert.equal(await reference.evaluate((node) => Boolean(document.getElementById(node.hash.slice(1)))), true);
  assert.equal(await post.getByRole('link', { name: /각주 참조/ }).evaluate((node) => Boolean(document.getElementById(node.hash.slice(1)))), true);
  await post.locator('pre').filter({ hasText: 'firstLine()' }).waitFor();
  assert.equal(await post.locator('pre').filter({ hasText: 'console.log' }).evaluate((node) => node.scrollWidth > node.clientWidth), true);
  assert.equal(await panel(page).getByTestId('book-comments-content').evaluate((node) => node.scrollWidth === node.clientWidth), true);
}

async function post(body) {
  const r = await desktop.request.post(`${commentPath}&id=${randomUUID()}`, { data: { body } });
  assert.equal(r.status(), 201, await r.text());
}
async function assertFits(page) {
  const frame = await panel(page).boundingBox();
  const toolbar = await controls(page).boundingBox();
  const viewport = page.viewportSize();
  assert.ok(frame.x >= 0 && frame.x + frame.width <= viewport.width + 1);
  assert.ok(frame.y >= toolbar.y + toolbar.height && frame.y + frame.height <= viewport.height + 1);
  assert.ok(frame.width <= 480);
}
async function watch(context) {
  await context.addInitScript(() => {
    localStorage.setItem('pdfit.language', 'ko');
    localStorage.setItem('pdfit.library.view', 'covers');
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  return page;
}

try {
  const folders = await (await desktop.request.get('/api/folders')).json();
  assert.ok(folders.some((item) => item.isRoot && item.name === 'Viewer comments test library'));
  const initial = await (await desktop.request.get(commentPath)).json();
  const oldNotes = [...initial.comments];
  for (let page = 2; oldNotes.length < initial.total; page += 1) {
    const next = await (await desktop.request.get(`${commentPath}&page=${page}`)).json();
    assert.equal(next.page, page);
    assert.ok(next.comments.length > 0);
    oldNotes.push(...next.comments);
  }
  assert.ok(oldNotes.every(({ body }) => seedNotes.includes(body) || [noteTitle, viewerNote, editedNote].includes(body)));
  for (const { id } of oldNotes) {
    assert.equal((await desktop.request.delete(`${commentPath}&id=${id}`)).status(), 204);
  }
  for (const body of seedNotes) await post(body);
  const page = await watch(desktop);
  await desktop.tracing.start({ screenshots: true, snapshots: true });
  await page.goto(viewerPath);
  await page.getByTestId('pdf-scroll-area').waitFor();
  await toggle(page).click();
  await panelText(page, titles[5]).waitFor();
  assert.equal(await panel(page).getAttribute('aria-modal'), 'false');
  assert.equal(await panel(page).getByRole('article').count(), 5);
  assert.equal(await panel(page).getByRole('article').filter({ hasText: titles[1] }).locator('br').count(), 45);
  await assertFits(page);
  const start = await panel(page).boundingBox();
  const handle = await page.getByTestId('viewer-comments-drag-handle').boundingBox();
  await page.mouse.move(handle.x + 60, handle.y + 12);
  await page.mouse.down();
  await page.mouse.move(handle.x - 110, handle.y + 62, { steps: 12 });
  await page.mouse.up();
  const moved = await panel(page).boundingBox();
  assert.ok(moved.x < start.x - 100 && moved.y > start.y + 25, 'PDF.js drag moves the panel');
  await page.screenshot({ path: path.join(artifacts, 'pdfjs-comments.png'), animations: 'disabled' });
  const body = panel(page).getByTestId('book-comments-content');
  await body.hover({ position: { x: 40, y: 80 } });
  await page.mouse.wheel(0, 300);
  await page.waitForFunction(() => document.querySelector('[data-testid="book-comments-content"]').scrollTop > 0);
  const pageInput = controls(page).getByRole('textbox', { name: '페이지 번호' });
  await pageInput.fill('2');
  await pageInput.press('Enter');
  assert.equal(await pageInput.inputValue(), '2');
  assert.equal(await toggle(page).getAttribute('aria-expanded'), 'true');
  await toggle(page).click();
  await panel(page).waitFor({ state: 'hidden' });
  assert.equal(await toggle(page).getAttribute('aria-expanded'), 'false');

  await page.goto(`${viewerPath}?engine=gpu`);
  await page.getByTestId('pdfgpu-scroll-area').waitFor();
  await toggle(page).click();
  await panelText(page, titles[5]).waitFor();
  const gpuStart = await panel(page).boundingBox();
  const gpuHandle = page.getByTestId('viewer-comments-drag-handle');
  await gpuHandle.focus();
  await gpuHandle.press('Shift+ArrowLeft');
  assert.ok((await panel(page).boundingBox()).x <= gpuStart.x - 19);
  await panel(page).getByRole('button', { name: '다음 페이지', exact: true }).click();
  await panelText(page, titles[0]).waitFor();
  assert.equal(await panel(page).getByRole('article').count(), 1);
  await panel(page).getByRole('button', { name: '새 코멘트', exact: true }).click();
  await editor(page).fill(viewerNote);
  assert.equal(await editor(page).evaluate((node) => node.tagName), 'TEXTAREA');
  await panel(page).getByRole('button', { name: '저장', exact: true }).click();
  await assertMarkdown(page, 'Quoted passage');
  assert.equal((await (await desktop.request.get(commentPath)).json()).comments[0].body, viewerNote);
  await page.screenshot({ path: path.join(artifacts, 'pdfgpu-comments.png'), animations: 'disabled' });
  await panel(page).getByRole('button', { name: '닫기', exact: true }).click();
  await panel(page).waitFor({ state: 'hidden' });
  assert.equal(await toggle(page).getAttribute('aria-expanded'), 'false');
  assert.equal(await toggle(page).evaluate((node) => document.activeElement === node), true);

  await page.goto(`/folder/${folder}`);
  await page.getByTestId('pdf-cover-card').getByRole('button', { name: '코멘트', exact: true }).click();
  await assertMarkdown(page, 'Quoted passage');
  assert.equal(await panel(page).getAttribute('aria-modal'), 'true');
  await markdownPost(page).getByRole('button', { name: '수정', exact: true }).click();
  assert.equal(await editor(page).inputValue(), viewerNote);
  await editor(page).fill(editedNote);
  await page.screenshot({ path: path.join(artifacts, 'cover-markdown-edit.png'), animations: 'disabled' });
  await panel(page).getByRole('button', { name: '저장', exact: true }).click();
  await assertMarkdown(page, 'Edited passage');
  assert.equal((await (await desktop.request.get(commentPath)).json()).comments[0].body, editedNote);
  await markdownPost(page).getByRole('button', { name: '삭제', exact: true }).click();
  await assertMarkdown(page, 'Edited passage');
  await page.screenshot({ path: path.join(artifacts, 'cover-markdown-delete-preview.png'), animations: 'disabled' });
  await panel(page).getByRole('button', { name: '취소', exact: true }).click();
  await panel(page).getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '목록 보기', exact: true }).click();
  await page.getByRole('listitem').filter({ has: page.getByRole('link', { name: filename, exact: true }) })
    .getByRole('button', { name: '코멘트', exact: true }).click();
  await assertMarkdown(page, 'Edited passage');
  await page.screenshot({ path: path.join(artifacts, 'list-markdown.png'), animations: 'disabled' });

  const touch = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 }, locale: 'ko-KR', isMobile: true, hasTouch: true });
  const mobile = await watch(touch);
  await mobile.goto(viewerPath);
  await mobile.getByTestId('pdf-scroll-area').waitFor();
  await toggle(mobile).tap();
  await assertMarkdown(mobile, 'Edited passage');
  const initialTouch = await panel(mobile).boundingBox();
  const touchGrip = await mobile.getByTestId('viewer-comments-drag-handle').boundingBox();
  const cdp = await touch.newCDPSession(mobile);
  const point = { x: touchGrip.x + 45, y: touchGrip.y + 12 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  for (let offset = 5; offset <= 45; offset += 5) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y + offset }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.ok((await panel(mobile).boundingBox()).y > initialTouch.y + 20, 'touch drag moves the panel');
  await mobile.setViewportSize({ width: 320, height: 670 });
  await mobile.waitForFunction(() => {
    const frame = document.querySelector('[data-testid="viewer-comments-drag-handle"]')
      ?.closest('[role="dialog"]')?.getBoundingClientRect();
    return frame && frame.right <= window.innerWidth + 1 && frame.bottom <= window.innerHeight + 1;
  });
  await assertFits(mobile);
  await assertMarkdown(mobile, 'Edited passage');
  await mobile.screenshot({ path: path.join(artifacts, 'touch-comments.png'), animations: 'disabled' });
  await touch.close();
  assert.deepEqual(errors, []);
  console.log('PASS PDF.js, PDFGPU, cover and list Markdown; raw textarea and persisted source; delete preview; GFM and narrow layout; comment paging and drag');
} finally {
  await desktop.tracing.stop({ path: path.join(artifacts, 'trace.zip') }).catch(() => undefined);
  await browser.close();
}
