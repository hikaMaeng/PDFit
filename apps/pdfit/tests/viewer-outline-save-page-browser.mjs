import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15233';
const output = process.env.PDFIT_TEST_OUTPUT ?? 'test/20261127/outline-save-page-headless-browser-test';
const folder = 'OutlineFixture';
const stateUrl = (file) => `${origin}/api/viewer-state/${folder}/${file}`;
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
const saveButton = (title, number) => row(title).getByRole('button', { name: `${number}페이지로 이동하고 읽기 위치 저장` });
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
  await saveButton('Chapter 2', 3).waitFor({ timeout: 45000 });
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
  await saveButton('Chapter 2', 3).waitFor();
  assert.deepEqual(await dialog.boundingBox(), stored);
  steps.push({ popup: 'moved, limited, resized, and restored', stored });

  await pageInput.fill('2');
  await pageInput.press('Enter');
  assert.equal(await pageInput.inputValue(), '2');
  assert.equal(await dialog.isVisible(), true);
  await closeButton.click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await outlineTrigger.evaluate((element) => document.activeElement === element), true);
  await outlineTrigger.click();
  return stored;
}

async function selectAndVerify(file, title, destination, expectedPage = destination, reject = false) {
  const url = stateUrl(file);
  const started = performance.now();
  const [result] = await Promise.all([
    page.waitForResponse((item) => item.url() === url && item.request().method() === 'PUT'
      && item.request().postDataJSON().page === expectedPage, { timeout: 1200 }),
    saveButton(title, destination).click(),
  ]);
  const elapsedMs = Math.round(performance.now() - started);
  assert.equal(result.status(), reject ? 503 : 200);
  if (reject) {
    await dialog.getByRole('alert').filter({ hasText: '읽기 위치를 저장하지 못했습니다.' }).waitFor();
  } else {
    await dialog.waitFor({ state: 'hidden' });
    assert.equal((await (await fetch(url)).json()).page, expectedPage);
  }
  assert.equal(await pageInput.inputValue(), String(expectedPage));
  steps.push({ file, destination, expectedPage, http: result.status(), elapsedMs });
}

try {
  await open('original.pdf', 'legacy', 'single');
  assert.equal(await row('Website').getByRole('button', { name: /읽기 위치 저장/ }).count(), 0);
  assert.equal(await row('Missing').getByRole('button', { name: /읽기 위치 저장/ }).count(), 0);
  await page.screenshot({ path: join(output, 'outline-save-icon-desktop.png') });
  const storedGeometry = await verifyPopup();
  await selectAndVerify('original.pdf', 'Chapter 2', 3);

  const fresh = await browser.newContext({ locale: 'ko-KR' });
  try {
    const reopened = await fresh.newPage();
    await reopened.goto(`${origin}/viewer/${folder}/original.pdf`, { waitUntil: 'domcontentloaded' });
    await reopened.locator('input[aria-label="페이지 번호"][value="3"]').waitFor();
  } finally {
    await fresh.close();
  }

  await outlineTrigger.click();
  const reject = (route) => route.fulfill({ status: 503, body: 'test failure' });
  await page.route(stateUrl('original.pdf'), reject, { times: 1 });
  await selectAndVerify('original.pdf', 'Chapter 1', 1, 1, true);
  await selectAndVerify('original.pdf', 'Chapter 1', 1);

  await open('spread.pdf', 'legacy', 'double');
  assert.notEqual((await dialog.boundingBox()).width, storedGeometry.width);
  await selectAndVerify('spread.pdf', 'Section 1.1', 2, 1);

  await open('scroll.pdf', 'legacy', 'scroll');
  await selectAndVerify('scroll.pdf', 'Chapter 2', 3);
  assert.ok((await (await fetch(stateUrl('scroll.pdf'))).json()).scrollTop > 0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('input[aria-label="페이지 번호"][value="3"]').waitFor();

  await page.setViewportSize({ width: 390, height: 844 });
  await open('gpu.pdf', 'gpu', 'single');
  await page.screenshot({ path: join(output, 'outline-save-icon-mobile.png') });
  await selectAndVerify('gpu.pdf', 'Chapter 2', 3);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('input[aria-label="페이지 번호"][value="3"]').waitFor();
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
