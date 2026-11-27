import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15233';
const output = process.env.PDFIT_TEST_OUTPUT ?? 'test/20261127/outline-save-page-headless-browser-test';
const folder = 'OutlineFixture';
const stateUrl = (file) => `${origin}/api/viewer-state/${folder}/${file}`;
const outlineUrl = (file) => `${origin}/api/outlines/${folder}/${file}`;
const initialState = { page: 1, scale: 2, fitMode: 'none', viewMode: 'single', inverted: false, uiHidden: false, scrollTop: 0 };

await mkdir(output, { recursive: true });
assert.equal((await fetch(`${origin}/health`)).status, 200);
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PDFIT_TEST_CHANNEL,
  args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const dialog = page.getByRole('dialog', { name: '목차' });
const pageInput = page.getByRole('textbox', { name: '페이지 번호' });
const outlineTrigger = page.getByTestId('viewer-outline-open');
const closeButton = dialog.getByRole('button', { name: '닫기', exact: true });
const resizeHandle = dialog.getByRole('button', { name: '팝업 크기 조절' });
const row = (title) => dialog.getByRole('listitem').filter({ hasText: title });
const entry = (title) => row(title).getByTestId('pdf-outline-entry');
const saveButton = (title, number) => row(title).getByRole('button', { name: `현재 페이지로 설정 (${number}페이지)`, exact: true });
const waitForPage = (number) => pageInput.and(page.locator(`[value="${number}"]`)).waitFor();
const errors = [];
const steps = [];
let failure;
page.on('pageerror', (error) => errors.push(error.message));
await context.tracing.start({ screenshots: true, snapshots: true });

async function open(file, engine, viewMode) {
  const seed = await fetch(stateUrl(file), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...initialState, viewMode }),
  });
  assert.equal(seed.status, 200);
  await page.goto(`${origin}/viewer/${folder}/${file}?engine=${engine}`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId(engine === 'gpu' ? 'pdfgpu-scroll-area' : 'pdf-scroll-area').waitFor({ timeout: 45000 });
  await pageInput.waitFor();
  await outlineTrigger.click();
  const regenerate = dialog.getByRole('button', { name: '재생성', exact: true });
  const [response] = await Promise.all([
    page.waitForResponse((item) => item.url() === outlineUrl(file) && item.request().method() === 'PUT'
      && item.request().postDataJSON().generated === true),
    regenerate.click({ timeout: 45000 }),
  ]);
  assert.equal(response.status(), 200);
  await entry('Chapter 2').waitFor();
}

async function drag(handle, dx, dy) {
  const box = await handle.boundingBox();
  assert.ok(box);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
}

async function verifyPopup() {
  assert.equal(await dialog.getAttribute('aria-modal'), 'false');
  assert.equal(await closeButton.count(), 1);
  const original = await dialog.boundingBox();
  const title = dialog.getByTitle('목차 창 이동');
  await drag(title, -80, 24);
  const moved = await dialog.boundingBox();
  assert.equal(moved.x, original.x - 80);
  assert.equal(moved.y, original.y + 24);

  await drag(resizeHandle, -500, -580);
  const minimum = await dialog.boundingBox();
  assert.equal(minimum.width, 300);
  assert.equal(minimum.height, 260);
  await drag(resizeHandle, 90, 90);
  await resizeHandle.press('ArrowRight');
  const stored = await dialog.boundingBox();
  assert.equal(stored.width, 395);
  assert.equal(stored.height, 350);
  await page.screenshot({ path: join(output, 'outline-floating-resized.png') });

  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await outlineTrigger.evaluate((element) => document.activeElement === element), true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await outlineTrigger.click();
  await entry('Chapter 2').waitFor();
  assert.deepEqual(await dialog.boundingBox(), stored);
  steps.push({ popup: 'moved, limited, resized, and restored', stored });

  await pageInput.fill('2');
  await pageInput.press('Enter');
  await waitForPage(2);
  assert.equal(await dialog.isVisible(), true);
  await closeButton.click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await outlineTrigger.evaluate((element) => document.activeElement === element), true);
  await outlineTrigger.click();
  return stored;
}

async function navigate(title, destination, expectedPage = destination) {
  assert.equal(await entry(title).getAttribute('data-page'), String(destination));
  await entry(title).click();
  await waitForPage(expectedPage);
  assert.equal(await dialog.isVisible(), true);
  steps.push({ navigate: title, destination, expectedPage, popupOpen: true });
}

async function storedOutline(url) {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return (await response.json()).entries;
}

async function setPageAndVerify(file, title, previous, current, reject = false) {
  const url = outlineUrl(file);
  const before = await storedOutline(url);
  assert.equal(before.find((item) => item.title === title).page, previous);
  await waitForPage(current);
  assert.equal(await entry(title).getAttribute('data-page'), previous === null ? '' : String(previous));
  const expected = before.map((item) => item.title === title ? { ...item, page: current } : item);
  const [result] = await Promise.all([
    page.waitForResponse((item) => item.url() === url && item.request().method() === 'PUT'),
    saveButton(title, current).click(),
  ]);
  assert.equal(result.status(), reject ? 503 : 200);
  assert.deepEqual(result.request().postDataJSON().entries, expected);
  if (reject) {
    await dialog.getByRole('alert').filter({ hasText: '목차 변경사항을 저장하지 못했습니다.' }).waitFor();
    assert.equal(await entry(title).getAttribute('data-page'), String(previous));
  } else {
    await entry(title).and(dialog.locator(`[data-page="${current}"]`)).waitFor();
    assert.equal(await dialog.getByRole('alert').count(), 0);
  }
  assert.deepEqual(await storedOutline(url), reject ? before : expected);
  assert.equal(await dialog.isVisible(), true);
  assert.equal(await pageInput.inputValue(), String(current));
  steps.push({ file, title, previous, page: current, http: result.status(), popupOpen: true });
}

try {
  await open('original.pdf', 'legacy', 'single');
  const storedGeometry = await verifyPopup();
  await navigate('Chapter 2', 3);
  assert.equal(await entry('Chapter 2').getAttribute('aria-current'), 'location');
  await setPageAndVerify('original.pdf', 'Chapter 1', 1, 3);
  await page.screenshot({ path: join(output, 'outline-page-updated-desktop.png') });

  await pageInput.fill('1');
  await pageInput.press('Enter');
  await waitForPage(1);
  assert.equal(await dialog.isVisible(), true);
  await page.route(outlineUrl('original.pdf'), (route) => route.fulfill({ status: 503, body: 'test failure' }), { times: 1 });
  await setPageAndVerify('original.pdf', 'Chapter 2', 3, 1, true);
  await page.screenshot({ path: join(output, 'outline-page-save-failure.png') });
  await setPageAndVerify('original.pdf', 'Chapter 2', 3, 1);
  assert.equal(await entry('Missing').isEnabled(), false);
  await setPageAndVerify('original.pdf', 'Missing', null, 1);
  assert.equal(await entry('Missing').isEnabled(), true);

  const fresh = await browser.newContext({ locale: 'ko-KR' });
  try {
    const reopened = await fresh.newPage();
    await reopened.goto(`${origin}/viewer/${folder}/original.pdf`, { waitUntil: 'domcontentloaded' });
    await reopened.getByTestId('viewer-outline-open').click();
    const reopenedList = reopened.getByRole('dialog', { name: '목차' }).getByTestId('pdf-outline-list');
    for (const [title, number] of [['Chapter 1', 3], ['Chapter 2', 1], ['Missing', 1]]) {
      const saved = reopenedList.getByTestId('pdf-outline-entry').filter({ hasText: title });
      assert.equal(await saved.getAttribute('data-page'), String(number));
    }
  } finally {
    await fresh.close();
  }
  steps.push({ file: 'original.pdf', popup: 'stored destinations restored in a fresh browser context' });

  await open('spread.pdf', 'legacy', 'double');
  assert.notEqual((await dialog.boundingBox()).width, storedGeometry.width);
  await navigate('Chapter 2', 3);
  await navigate('Section 1.1', 2, 1);
  await setPageAndVerify('spread.pdf', 'Chapter 2', 3, 1);

  await open('scroll.pdf', 'legacy', 'scroll');
  await navigate('Chapter 2', 3);
  const scrollArea = page.getByTestId('pdf-scroll-area');
  await page.waitForFunction(() => {
    const area = document.querySelector('[data-testid="pdf-scroll-area"]');
    return area && area.scrollTop > 0 && area.scrollHeight - area.clientHeight - area.scrollTop <= 1;
  });
  const scrollTop = await scrollArea.evaluate((area) => area.scrollTop);
  await setPageAndVerify('scroll.pdf', 'Chapter 1', 1, 3);
  assert.equal(await scrollArea.evaluate((area) => area.scrollTop), scrollTop);

  // Each small window leaves space for movement on the unclipped axis.
  for (const { file, viewport, axis, dx, dy } of [
    { file: 'scroll.pdf', viewport: { width: 390, height: 1100 }, axis: 'width', dx: 0, dy: 30 },
    { file: 'spread.pdf', viewport: { width: 900, height: 500 }, axis: 'height', dx: 30, dy: 0 },
  ]) {
    await page.setViewportSize(viewport);
    await open(file, 'legacy', 'single');
    const before = await dialog.boundingBox();
    assert.ok(before[axis] < (axis === 'width' ? 560 : 660));
    await drag(dialog.getByTitle('목차 창 이동'), dx, dy);
    const moved = await dialog.boundingBox();
    assert.equal(moved.x, before.x + dx);
    assert.equal(moved.y, before.y + dy);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await outlineTrigger.click();
    await entry('Chapter 2').waitFor();
    const restored = await dialog.boundingBox();
    assert.equal(restored.width, 560);
    assert.equal(restored.height, 660);
    await page.screenshot({ path: join(output, `outline-restored-after-clipped-${axis}.png`) });
    steps.push({ popup: 'moving preserves its preferred size', clipped: axis, width: restored.width, height: restored.height });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await open('gpu.pdf', 'gpu', 'single');
  await navigate('Chapter 2', 3);
  await setPageAndVerify('gpu.pdf', 'Chapter 1', 1, 3);
  await page.getByTestId('viewer-load-progress-panel').waitFor({ state: 'hidden' });
  assert.equal(await pageInput.inputValue(), '3');
  await page.screenshot({ path: join(output, 'outline-page-updated-mobile.png') });
  assert.equal(await page.getByTestId('pdfgpu-scroll-area').count(), 1);

  const rtl = await browser.newContext({ locale: 'ar', viewport: { width: 900, height: 760 } });
  try {
    const rtlPage = await rtl.newPage();
    await rtlPage.goto(`${origin}/viewer/${folder}/spread.pdf`, { waitUntil: 'domcontentloaded' });
    await rtlPage.getByTestId('viewer-outline-open').click();
    const rtlDialog = rtlPage.getByRole('dialog', { name: 'جدول المحتويات' });
    const rtlClose = rtlDialog.getByRole('button', { name: 'إغلاق', exact: true });
    await rtlClose.waitFor();
    const [panel, close] = await Promise.all([rtlDialog.boundingBox(), rtlClose.boundingBox()]);
    assert.ok(panel.x + panel.width - close.x - close.width < 20);
    assert.ok(close.y - panel.y < 20);
    await rtlPage.screenshot({ path: join(output, 'outline-close-rtl.png') });
    steps.push({ popup: 'top-right close in Arabic' });
  } finally {
    await rtl.close();
  }
  assert.deepEqual(errors, []);
} catch (error) {
  failure = error.message;
  await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await context.tracing.stop({ path: join(output, 'trace.zip') });
  await browser.close();
  const results = { origin, steps, errors, failure };
  await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
