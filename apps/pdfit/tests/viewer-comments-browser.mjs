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
const otherBookPath = '/viewer/Other/Second%20book.pdf';
const commentPath = `/api/book-comments?${new URLSearchParams({ folder, filename })}`;
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader'] });
const desktop = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 850 }, locale: 'ko-KR' });
const errors = [];
const titles = Array.from({ length: 6 }, (_, index) => `Example reading note ${index + 1}`);
const noteTitle = 'Written from the PDFGPU viewer';
const imageName = 'reading-diagram.png';
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
function resizeHandle(page) { return panel(page).getByRole('button', { name: /크기 조절/ }); }
async function drag(page, handle, x, y) {
  const box = await handle.boundingBox();
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + x, start.y + y, { steps: 10 });
  await page.mouse.up();
}
async function assertImage(post) {
  const image = post.getByRole('img', { name: imageName, exact: true });
  await image.scrollIntoViewIfNeeded();
  await image.evaluate((node) => node.decode());
  assert.equal(await image.evaluate((node) => node.clientWidth === node.closest('article').clientWidth &&
    node.naturalWidth < node.clientWidth && Math.abs(node.clientHeight - node.clientWidth * node.naturalHeight / node.naturalWidth) <= 1), true);
  return image.getAttribute('src');
}
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
  await drag(page, resizeHandle(page), -300, -400);
  const minimum = await panel(page).boundingBox();
  assert.equal(minimum.width, 320);
  assert.equal(minimum.height, 300);
  await drag(page, resizeHandle(page), 210, 155);
  const resized = await panel(page).boundingBox();
  assert.equal(resized.width, 530);
  assert.equal(resized.height, 455);
  assert.equal(resized.x, moved.x);
  assert.equal(resized.y, moved.y);
  await assertFits(page);
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

  await page.goto(otherBookPath);
  await page.getByTestId('pdf-scroll-area').waitFor();
  await toggle(page).click();
  await panelText(page, '이 책에 남긴 코멘트가 없습니다.').waitFor();
  assert.equal((await panel(page).boundingBox()).width, 480, 'a second book starts with the default width');

  await page.goto(`${viewerPath}?engine=gpu`);
  await page.getByTestId('pdfgpu-scroll-area').waitFor();
  await toggle(page).click();
  await panelText(page, titles[5]).waitFor();
  const gpuStart = await panel(page).boundingBox();
  assert.deepEqual(gpuStart, resized, 'the original book restores its size and position after navigation');
  const gpuHandle = page.getByTestId('viewer-comments-drag-handle');
  await gpuHandle.focus();
  await gpuHandle.press('Shift+ArrowLeft');
  assert.ok((await panel(page).boundingBox()).x <= gpuStart.x - 19);
  await resizeHandle(page).press('Shift+ArrowRight');
  assert.equal((await panel(page).boundingBox()).width, gpuStart.width + 20);
  await panel(page).getByRole('button', { name: '다음 페이지', exact: true }).click();
  await panelText(page, titles[0]).waitFor();
  assert.equal(await panel(page).getByRole('article').count(), 1);
  await panel(page).getByRole('button', { name: '새 코멘트', exact: true }).click();
  await editor(page).fill(viewerNote);
  assert.equal(await editor(page).evaluate((node) => node.tagName), 'TEXTAREA');
  const fileInput = panel(page).getByLabel('이미지 첨부', { exact: true });
  const diagram = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 192;
    canvas.height = 68;
    const context = canvas.getContext('2d');
    context.fillStyle = '#e6eef5';
    context.fillRect(0, 0, 192, 68);
    context.strokeStyle = '#315476';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(35, 45);
    context.lineTo(96, 22);
    context.lineTo(157, 45);
    context.stroke();
    for (const [x, y, color] of [[35, 45, '#277886'], [96, 22, '#315476'], [157, 45, '#277886']]) {
      context.fillStyle = color;
      context.beginPath();
      context.arc(x, y, 9, 0, Math.PI * 2);
      context.fill();
    }
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const imageFile = { name: imageName, mimeType: 'image/png', buffer: Buffer.from(diagram, 'base64') };
  await fileInput.setInputFiles({ name: 'rejected.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await panel(page).getByRole('alert').getByText(/최대 4개/).waitFor();
  await fileInput.setInputFiles(imageFile);
  await panel(page).getByRole('button', { name: `${imageName} 첨부 해제` }).waitFor();
  await panel(page).getByRole('button', { name: '저장', exact: true }).click();
  await assertMarkdown(page, 'Quoted passage');
  const imageUrl = await assertImage(markdownPost(page));
  const savedComment = (await (await desktop.request.get(commentPath)).json()).comments[0];
  assert.equal(savedComment.body, viewerNote);
  assert.deepEqual(savedComment.images.map(({ name }) => name), [imageName]);
  const storedImage = await desktop.request.get(imageUrl);
  assert.equal(storedImage.headers()['content-type'], 'image/png');
  assert.deepEqual(await storedImage.body(), imageFile.buffer);
  const wrongBookImage = new URL(imageUrl, origin);
  wrongBookImage.searchParams.set('filename', 'Second book.pdf');
  wrongBookImage.searchParams.set('folder', 'Other');
  assert.equal((await desktop.request.get(wrongBookImage.href)).status(), 404);
  const forged = await desktop.request.post(`${commentPath}&id=${randomUUID()}`, { data: {
    body: '', images: [{ id: randomUUID(), name: 'fake.png', mimeType: 'image/png', base64: Buffer.from('<svg/>').toString('base64') }],
  } });
  assert.equal(forged.status(), 400);
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
  await assertImage(markdownPost(page));
  assert.equal((await (await desktop.request.get(commentPath)).json()).comments[0].body, editedNote);
  await markdownPost(page).getByRole('button', { name: '삭제', exact: true }).click();
  await assertMarkdown(page, 'Edited passage');
  await assertImage(markdownPost(page));
  await page.screenshot({ path: path.join(artifacts, 'cover-markdown-delete-preview.png'), animations: 'disabled' });
  await panel(page).getByRole('button', { name: '취소', exact: true }).click();
  await panel(page).getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '목록 보기', exact: true }).click();
  await page.getByRole('listitem').filter({ has: page.getByRole('link', { name: filename, exact: true }) })
    .getByRole('button', { name: '코멘트', exact: true }).click();
  await assertMarkdown(page, 'Edited passage');
  await assertImage(markdownPost(page));
  await page.screenshot({ path: path.join(artifacts, 'list-markdown.png'), animations: 'disabled' });

  const touch = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 }, locale: 'ko-KR', isMobile: true, hasTouch: true });
  const mobile = await watch(touch);
  await mobile.goto(viewerPath);
  await mobile.getByTestId('pdf-scroll-area').waitFor();
  await toggle(mobile).tap();
  await assertMarkdown(mobile, 'Edited passage');
  await assertImage(markdownPost(mobile));
  const initialTouch = await panel(mobile).boundingBox();
  const touchGrip = await mobile.getByTestId('viewer-comments-drag-handle').boundingBox();
  const cdp = await touch.newCDPSession(mobile);
  const resize = await resizeHandle(mobile).boundingBox();
  const corner = { x: resize.x + resize.width / 2, y: resize.y + resize.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [corner] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: corner.x, y: corner.y - 40 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal((await panel(mobile).boundingBox()).height, initialTouch.height - 40);
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

  const rtl = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 850 }, locale: 'ar' });
  await rtl.addInitScript(() => localStorage.setItem('pdfit.language', 'ar'));
  const rtlPage = await rtl.newPage();
  rtlPage.on('pageerror', (error) => errors.push(error.message));
  await rtlPage.goto(viewerPath);
  await rtlPage.getByTestId('pdf-scroll-area').waitFor();
  await controls(rtlPage).getByRole('button', { name: 'التعليقات', exact: true }).click();
  const rtlPanel = rtlPage.getByRole('dialog', { name: 'التعليقات', exact: true });
  const rtlClose = rtlPanel.getByRole('button', { name: 'إغلاق', exact: true });
  assert.equal(await rtlClose.count(), 1);
  const rtlFrame = await rtlPanel.boundingBox();
  const rtlCloseBox = await rtlClose.boundingBox();
  const rtlResize = await rtlPanel.getByRole('button', { name: 'تغيير حجم النافذة المنبثقة' }).boundingBox();
  assert.ok(rtlCloseBox.x > rtlFrame.x + rtlFrame.width / 2, 'X stays on the upper right in RTL');
  assert.ok(rtlResize.x + rtlResize.width >= rtlFrame.x + rtlFrame.width - 2, 'resize stays on the lower right in RTL');
  await rtlClose.press('Escape');
  await rtlPanel.waitFor({ state: 'hidden' });
  await rtl.close();

  await panel(page).getByRole('button', { name: '새 코멘트', exact: true }).click();
  await fileInput.setInputFiles(imageFile);
  await panel(page).getByRole('button', { name: '저장', exact: true }).click();
  const imageOnlyPost = panel(page).getByRole('article').filter({ has: page.getByRole('img', { name: imageName, exact: true }) })
    .filter({ hasNot: page.getByRole('heading', { name: noteTitle, exact: true }) });
  const imageOnlyUrl = await assertImage(imageOnlyPost);
  await imageOnlyPost.getByRole('button', { name: '삭제', exact: true }).click();
  await panel(page).getByRole('button', { name: '삭제', exact: true }).click();
  await imageOnlyPost.waitFor({ state: 'hidden' });
  assert.equal((await desktop.request.get(imageOnlyUrl)).status(), 404);

  await markdownPost(page).getByRole('button', { name: '수정', exact: true }).click();
  await panel(page).getByRole('button', { name: `${imageName} 첨부 해제` }).click();
  await panel(page).getByRole('button', { name: '저장', exact: true }).click();
  await assertMarkdown(page, 'Edited passage');
  assert.equal((await desktop.request.get(imageUrl)).status(), 404);
  assert.deepEqual(errors, []);
  console.log('PASS PDF.js, PDFGPU, cover and list Markdown; comment images, width, validation and removal; paging, move, minimum resize and per-book restore');
} finally {
  await desktop.tracing.stop({ path: path.join(artifacts, 'trace.zip') }).catch(() => undefined);
  await browser.close();
}
