import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15233';
const output = process.env.PDFIT_TEST_OUTPUT ?? 'test/20261120/viewer-outline-management';
const folder = 'OutlineFixture';
const original = 'original.pdf';
const noOutline = 'no-outline.pdf';
const api = (file) => `${origin}/api/outlines/${folder}/${file}`;
const stored = async (file) => {
  const result = await fetch(api(file));
  assert.equal(result.status, 200);
  return (await result.json()).entries;
};

await mkdir(output, { recursive: true });
assert.equal((await fetch(`${origin}/health`)).status, 200);
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
const steps = [];
page.on('pageerror', (error) => errors.push(error.message));
await context.tracing.start({ screenshots: true, snapshots: true });
const dialog = page.getByRole('dialog', { name: '목차' });
const button = (name) => dialog.getByRole('button', { name, exact: true });
const rows = dialog.getByTestId('pdf-outline-edit-row');
const entries = dialog.getByTestId('pdf-outline-entry');

async function openViewer(file, engine = '') {
  await page.goto(`${origin}/viewer/${folder}/${file}${engine}`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('viewer-outline-open').click({ timeout: 45000 });
  await button('재생성').waitFor({ timeout: 45000 });
}

async function clickAndWait(name, method, status) {
  const response = page.waitForResponse((item) => item.url().startsWith(`${origin}/api/outlines/`) && item.request().method() === method);
  await button(name).click();
  assert.equal((await response).status(), status);
}

const record = (name) => { steps.push(name); console.log(`PASS ${name}`); };
let failure;
try {
  await openViewer(original);
  const originalEntries = await stored(original);
  assert.equal(originalEntries.length, 6);
  await button('목차 편집').click();
  await rows.first().getByRole('textbox', { name: '제목' }).fill('수정한 장');
  const pageInput = rows.first().getByRole('spinbutton', { name: '페이지' });
  await pageInput.fill('4');
  await button('저장').click();
  assert.equal(await pageInput.evaluate((input) => input.validity.rangeOverflow), true);
  assert.deepEqual(await stored(original), originalEntries);
  await pageInput.fill('2');
  await rows.first().getByRole('spinbutton', { name: '수준' }).fill('2');
  await rows.nth(1).getByRole('button', { name: '2번 항목 삭제' }).click();
  await button('항목 추가').click();
  await rows.last().getByRole('textbox', { name: '제목' }).fill('새 목차 항목');
  await page.screenshot({ path: join(output, 'editor.png') });

  const failSave = (route) => route.fulfill({ status: 503, body: 'test fixture failure' });
  await page.route(api(original), failSave);
  await clickAndWait('저장', 'PUT', 503);
  await dialog.getByText('목차 변경사항을 저장하지 못했습니다.', { exact: false }).waitFor();
  assert.equal(await rows.first().getByRole('textbox', { name: '제목' }).inputValue(), '수정한 장');
  assert.deepEqual(await stored(original), originalEntries);
  await page.unroute(api(original), failSave);
  await clickAndWait('저장', 'PUT', 200);
  await entries.filter({ hasText: '수정한 장' }).waitFor();
  const edited = await stored(original);
  assert.deepEqual(edited[0], { key: '0', title: '수정한 장', depth: 1, page: 2 });
  assert.equal(edited.some((entry) => entry.title === 'Section 1.1'), false);
  assert.equal(edited.at(-1).title, '새 목차 항목');
  record('edit, validate page bounds, add and remove rows, and retry after a failed save');

  await openViewer(original);
  await entries.filter({ hasText: '수정한 장' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('textbox', { name: '페이지 번호' }).inputValue(), '2');
  await page.getByTestId('viewer-outline-open').click();
  await entries.filter({ hasText: '수정한 장' }).waitFor();
  assert.equal(await entries.and(dialog.locator('[aria-current="location"]')).getAttribute('data-page'), '2');
  record('reopen a saved outline and navigate to its edited page');

  await button('목차 삭제').click();
  await button('취소').click();
  assert.deepEqual(await stored(original), edited);
  await button('목차 삭제').click();
  await clickAndWait('삭제', 'DELETE', 204);
  await dialog.getByTestId('pdf-outline-deleted').waitFor();
  await openViewer(original);
  await dialog.getByTestId('pdf-outline-deleted').waitFor();
  assert.deepEqual(await stored(original), []);
  await page.screenshot({ path: join(output, 'deleted.png') });
  const initialization = await fetch(api(original), {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-None-Match': '*' },
    body: JSON.stringify({ entries: originalEntries }),
  });
  assert.equal(initialization.status, 412);
  assert.deepEqual(await stored(original), []);
  record('cancel or confirm deletion, preserve the deletion after reload, and prevent automatic restore');

  await clickAndWait('재생성', 'PUT', 200);
  await entries.filter({ hasText: 'Section 1.1' }).waitFor();
  assert.deepEqual(await stored(original), originalEntries);
  await page.screenshot({ path: join(output, 'regenerated.png') });
  record('regenerate from the original PDF outline');

  await page.setViewportSize({ width: 390, height: 844 });
  await openViewer(noOutline);
  assert.equal(await dialog.getByTestId('pdf-outline-failed').getAttribute('data-reason'), 'empty');
  await button('목차 편집').click();
  await rows.first().getByRole('textbox', { name: '제목' }).fill('직접 만든 목차');
  await page.screenshot({ path: join(output, 'editor-mobile.png') });
  await clickAndWait('저장', 'PUT', 200);
  await entries.filter({ hasText: '직접 만든 목차' }).waitFor();
  await button('재생성').click();
  await dialog.getByText('이 PDF에는 목차 정보가 없습니다.').waitFor();
  await entries.filter({ hasText: '직접 만든 목차' }).waitFor();
  assert.equal((await stored(noOutline))[0].title, '직접 만든 목차');
  record('create an outline for a PDF without one and keep it after failed regeneration');

  await page.setViewportSize({ width: 1440, height: 900 });
  await openViewer(original, '?engine=gpu');
  assert.equal(await page.getByTestId('pdfgpu-scroll-area').count(), 1);
  await clickAndWait('재생성', 'PUT', 200);
  await entries.filter({ hasText: 'Section 1.1' }).waitFor();
  assert.deepEqual(await stored(original), originalEntries);
  assert.deepEqual(errors, []);
  record('regenerate with PDFGPU and verify no browser page errors');
} catch (error) {
  failure = error.message;
  await page.screenshot({ path: join(output, 'failure.png') }).catch(() => undefined);
  throw error;
} finally {
  await context.tracing.stop({ path: join(output, 'trace.zip') });
  await browser.close();
  await writeFile(join(output, 'results.json'), JSON.stringify({ origin, steps, errors, failure }, null, 2));
}
