import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.PDFIT_OCR_POPUP_TEST_ORIGIN;
if (!origin) throw new Error('Set PDFIT_OCR_POPUP_TEST_ORIGIN to an isolated Free fixture runtime.');
const output = path.resolve(process.env.PDFIT_OCR_POPUP_TEST_OUTPUT ?? 'test/20261127/page-ocr-popup');
const folder = 'Fixtures';
const bookA = 'Page OCR A.pdf';
const bookB = 'Page OCR B with a long filename to check truncation when resizing the page text window.pdf';
const engine = process.env.PDFIT_OCR_POPUP_TEST_ENGINE ?? 'legacy';
const markdown = '# Corrected OCR\n\n**Bold phrase**\n\n- First item\n- Second item\n\n<script>ignored</script>\n\n'
  + Array.from({ length: 70 }, (_, index) => `Paragraph ${index + 1}\n`).join('\n');
const apiPath = '/api/ocr/page';
const pageApi = (filename, pageIndex, method = 'GET', data = {}) => {
  const target = { folder, filename, pageIndex };
  return method === 'GET' ? fetch(`${origin}${apiPath}?${new URLSearchParams(target)}`) :
    fetch(`${origin}${apiPath}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...target, ...data }),
    });
};
const searchEditedText = async () => {
  const response = await fetch(`${origin}/api/search/content/page-ocr?q=Corrected%20OCR`);
  assert.equal(response.status, 200);
  const { hits } = await response.json();
  return hits.some((hit) => hit.folder === folder && hit.filename === bookA && hit.page === 1);
};

await mkdir(output, { recursive: true });
for (const [filename, pageIndex] of [[bookA, 0], [bookA, 1], [bookB, 0]]) {
  const response = await pageApi(filename, pageIndex, 'POST');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).source, 'text-layer');
}
assert.equal((await pageApi(bookA, 2)).status, 204);

const browser = await chromium.launch({
  channel: process.env.PDFIT_TEST_CHANNEL ?? 'chrome',
  args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1240, height: 900 }, locale: 'ko-KR', permissions: ['clipboard-read', 'clipboard-write'] });
await context.addInitScript(() => {
  if (!localStorage.getItem('pdfit.language')) localStorage.setItem('pdfit.language', 'ko');
  localStorage.setItem('pdfit.color-mode', 'dark');
});
const page = await context.newPage();
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
const popup = page.getByTestId('page-ocr-dialog');
const trigger = page.getByRole('button', { name: '페이지 텍스트 읽기', exact: true });
const moveHandle = popup.getByTitle('페이지 텍스트 창 이동');
const resizeHandle = popup.getByRole('button', { name: /크기 조절/ });
const footer = popup.locator('footer');
const footerActions = ['텍스트 복사', '다시 읽기', '수정'];
const closeInset = (button) => button.evaluate((element) => {
  const header = element.closest('header');
  return {
    paddingRight: getComputedStyle(header).paddingRight,
    rightGap: header.getBoundingClientRect().right - element.getBoundingClientRect().right,
  };
});
const shot = (name) => page.screenshot({ path: path.join(output, `${name}.png`) });
const title = (number) => page.getByRole('dialog', { name: `${number}페이지 텍스트`, exact: true }).waitFor();
const rect = async () => {
  const bounds = await popup.boundingBox();
  assert.ok(bounds);
  return bounds;
};
const drag = async (locator, dx, dy) => {
  const box = await locator.boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
  await page.mouse.up();
};
const open = async (filename) => {
  await page.goto(`${origin}/viewer/${folder}/${encodeURIComponent(filename)}?page=1&engine=${engine}`);
  await trigger.click();
  await title(1);
};
const close = async () => {
  await popup.getByRole('button', { name: '닫기', exact: true }).click();
  await popup.waitFor({ state: 'hidden' });
};
const results = { origin, engine, pageErrors, consoleErrors };
try {
  await open(bookA);
  assert.equal(await popup.getAttribute('aria-modal'), 'false');
  const koClose = popup.getByRole('button', { name: '닫기', exact: true });
  assert.equal(await koClose.count(), 1);
  const koInset = await closeInset(koClose);
  assert.deepEqual(koInset, { paddingRight: '5px', rightGap: 5 });
  const pdfPage = page.getByRole('textbox', { name: '페이지 번호' });
  const viewerSurface = page.getByTestId(engine === 'gpu' ? 'pdfgpu-scroll-area' : 'pdf-scroll-area');
  await viewerSurface.waitFor();
  const header = popup.locator('header');
  assert.equal(await header.getByRole('heading', { name: bookA, exact: true }).count(), 1);
  assert.equal(await popup.getByText(bookA, { exact: true }).count(), 1);
  assert.equal(await popup.getByText('p.1', { exact: true }).count(), 1);
  assert.equal(await popup.getByText('텍스트', { exact: true }).count(), 0);
  assert.equal(await popup.getByTestId('page-ocr-source').count(), 0);
  await footer.getByRole('button', { name: '수정', exact: true }).waitFor();
  assert.doesNotMatch(await footer.innerText(), /\d+\.\d\s*s/);
  await pdfPage.click();
  assert.equal(await pdfPage.evaluate((element) => document.activeElement === element), true);
  const initial = await rect();
  await drag(moveHandle, 100, 65);
  const moved = await rect();
  assert.ok(moved.x > initial.x && moved.y > initial.y);
  await drag(resizeHandle, -800, -700);
  const minimum = await rect();
  assert.equal(minimum.width, 400);
  assert.equal(minimum.height, 280);
  await drag(resizeHandle, 220, 170);
  const savedGeometry = await rect();
  assert.ok(savedGeometry.width > minimum.width && savedGeometry.height > minimum.height);

  await footer.getByRole('button', { name: '수정', exact: true }).click();
  const editor = popup.getByRole('textbox', { name: '페이지 텍스트 (Markdown)' });
  assert.equal(await editor.evaluate((element) => element.tagName), 'TEXTAREA');
  const previous = await editor.inputValue();
  const editedText = previous === markdown ? `${markdown}\nDifferent revision\n` : markdown;
  await editor.fill(editedText);
  assert.equal(await popup.getByRole('button', { name: '다음 페이지' }).isDisabled(), true);
  await shot('editor');
  const saveResponse = page.waitForResponse((response) => response.url().endsWith(apiPath) && response.request().method() === 'PUT');
  await popup.getByRole('button', { name: '저장', exact: true }).click();
  assert.equal((await saveResponse).status(), 200);
  await popup.getByRole('heading', { name: 'Corrected OCR', exact: true }).waitFor();
  assert.equal(await popup.getByText('Bold phrase', { exact: true }).evaluate((element) => element.tagName), 'STRONG');
  assert.equal(await popup.getByRole('listitem').count(), 2);
  assert.equal(await popup.locator('script').count(), 0);
  await popup.getByRole('button', { name: '텍스트 복사', exact: true }).click();
  await popup.getByRole('button', { name: '복사했습니다', exact: true }).waitFor();
  assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n'), editedText);
  const body = popup.getByTestId('page-ocr-scroll');
  const overflow = await body.evaluate((element) => element.scrollHeight - element.clientHeight);
  assert.ok(overflow > 100);
  await shot('markdown');
  await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  assert.ok(await body.evaluate((element) => element.scrollTop > 100));
  const mountedPopup = await popup.elementHandle();
  await popup.getByRole('button', { name: '다음 페이지' }).click();
  await title(2);
  await popup.getByText('Fixture page two', { exact: true }).waitFor();
  assert.equal(await popup.evaluate((element, before) => element === before, mountedPopup), true);
  assert.deepEqual(await rect(), savedGeometry);
  assert.equal(await body.evaluate((element) => element.scrollTop), 0);
  assert.equal(await pdfPage.inputValue(), '1');
  await header.getByRole('button', { name: '뷰어에서 2페이지로 이동' }).click();
  await page.waitForFunction(() => document.querySelector('input[aria-label="페이지 번호"]').value === '2');
  await popup.getByText('p.2', { exact: true }).waitFor();
  assert.deepEqual(await rect(), savedGeometry);
  await shot('viewer-jump');
  const retryButton = footer.getByRole('button', { name: '다시 읽기', exact: true });
  const retryResponse = page.waitForResponse((response) => response.url().endsWith(apiPath) && response.request().method() === 'POST');
  await retryButton.click();
  const retried = await retryResponse;
  assert.equal(retried.status(), 200);
  assert.equal(retried.request().postDataJSON().pageIndex, 1);
  await popup.getByText('Fixture page two', { exact: true }).waitFor();
  await popup.getByRole('button', { name: '다음 페이지' }).click();
  await title(3);
  await popup.getByRole('button', { name: '스캔하기' }).waitFor();
  assert.deepEqual(await rect(), savedGeometry);
  assert.equal(await pdfPage.inputValue(), '2');
  await shot('unscanned');

  await close();
  await trigger.click();
  await title(2);
  assert.deepEqual(await rect(), savedGeometry);
  await close();
  await open(bookB);
  const otherBook = await rect();
  assert.notDeepEqual(otherBook, savedGeometry);
  const filename = header.getByRole('heading', { name: bookB, exact: true });
  const filenameLayout = () => filename.evaluate((element) => ({
    width: element.clientWidth, scrollWidth: element.scrollWidth, overflow: getComputedStyle(element).textOverflow,
  }));
  const fixedControls = [...await header.getByRole('button').all(),
    ...await Promise.all(footerActions.map(async (name) => {
      const button = footer.getByRole('button', { name, exact: true });
      await button.waitFor();
      return button;
    }))];
  const sizes = () => Promise.all(fixedControls.map(async (button) => (await button.boundingBox()).width));
  const wideFilename = await filenameLayout();
  const wideControlWidths = await sizes();
  await drag(resizeHandle, -700, -700);
  const minimumFilename = await filenameLayout();
  assert.ok(minimumFilename.width < wideFilename.width && minimumFilename.width < minimumFilename.scrollWidth);
  assert.equal(minimumFilename.overflow, 'ellipsis');
  assert.deepEqual(await sizes(), wideControlWidths);
  await shot('minimum');
  await close();
  await open(bookA);
  await popup.getByRole('heading', { name: 'Corrected OCR' }).waitFor();
  assert.deepEqual(await rect(), savedGeometry);
  await popup.getByRole('button', { name: '수정', exact: true }).click();
  await editor.fill('Unsaved draft');
  await close();
  await trigger.click();
  await popup.getByRole('heading', { name: 'Corrected OCR' }).waitFor();
  await page.setViewportSize({ width: 360, height: 440 });
  await page.waitForFunction(() => {
    const bounds = document.querySelector('[data-testid="page-ocr-dialog"]').getBoundingClientRect();
    return bounds.left >= 0 && bounds.top >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight;
  });
  for (const name of footerActions) {
    const button = footer.getByRole('button', { name, exact: true });
    await button.waitFor();
    assert.equal(await button.locator('span').filter({ hasText: name }).isVisible(), false);
  }
  await shot('narrow');
  await page.setViewportSize({ width: 1240, height: 900 });
  await close();
  await open(bookA);
  assert.deepEqual(await rect(), savedGeometry);
  const saved = await (await pageApi(bookA, 0)).json();
  assert.equal(saved.edited, true);
  assert.equal(saved.text, editedText);
  const reread = await (await pageApi(bookA, 0, 'POST')).json();
  assert.equal(reread.text, editedText);
  assert.equal((await pageApi(bookA, 0, 'PUT', { revision: '0'.repeat(64), text: 'stale' })).status, 409);
  assert.equal(await searchEditedText(), true);
  const clear = await pageApi(bookA, 0, 'PUT', { revision: saved.revision, text: '' });
  assert.equal(clear.status, 200);
  const cleared = await clear.json();
  try {
    assert.equal((await (await pageApi(bookA, 0)).json()).text, '');
    assert.equal(await searchEditedText(), false);
  } finally {
    assert.equal((await pageApi(bookA, 0, 'PUT', { revision: cleared.revision, text: editedText })).status, 200);
  }
  await page.evaluate(() => localStorage.setItem('pdfit.language', 'ar'));
  await page.reload();
  await page.getByRole('button', { name: 'قراءة نص الصفحة', exact: true }).click();
  const rtlClose = popup.getByRole('button', { name: 'إغلاق', exact: true });
  const rtlInset = await closeInset(rtlClose);
  assert.deepEqual(rtlInset, { paddingRight: '5px', rightGap: 5 });
  await rtlClose.focus();
  await page.keyboard.press('Escape');
  await popup.waitFor({ state: 'hidden' });
  assert.deepEqual(pageErrors, []);
  Object.assign(results, { verdict: 'PASS', initial, moved, minimum, savedGeometry, otherBook, overflow,
    viewerJump: 2, closeInset: { ko: koInset, ar: rtlInset }, wideFilename, minimumFilename, fixedControlWidths: wideControlWidths });
} catch (error) {
  results.verdict = 'FAIL';
  results.error = String(error.stack ?? error);
  await shot('failure').catch(() => undefined);
  throw error;
} finally {
  await writeFile(path.join(output, 'result.json'), `${JSON.stringify(results, null, 2)}\n`);
  await browser.close();
}
