import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// 표지 카드 정보 오버레이의 "최종 페이지"가 뷰어가 실제로 저장하는 값(`viewer_state.page`)과 같은지 배포된 서버에서 검증한다.
// 읽기 전용: 실제 라이브러리에서 저장 페이지가 1보다 큰 책과 저장 기록이 없는 책을 API로 찾아 오버레이를 연다.
// 기대값은 `GET /api/viewer-state/...`와 `GET /api/progress/...` 응답에서 독립적으로 가져온다.
const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const folder = process.env.PDFIT_TEST_FOLDER ?? '이북';
const runId = process.env.PDFIT_TEST_RUN ?? '20261111_cover-last-page';
const output = new URL(`./reports/cover-last-page/${runId}/`, import.meta.url);
await mkdir(output, { recursive: true });
const shot = (name) => decodeURIComponent(new URL(name, output).pathname.slice(1));

const results = { origin, folder, channel: process.env.PDFIT_TEST_CHANNEL ?? 'playwright-bundled' };
const files = await (await fetch(`${origin}/api/folders/${encodeURIComponent(folder)}/files`)).json();
const list = Array.isArray(files) ? files : files.files;
const stateOf = async (name) => {
  const response = await fetch(`${origin}/api/viewer-state/${encodeURIComponent(folder)}/${encodeURIComponent(name)}`);
  return response.ok ? response.json() : null;
};
const progressOf = async (name) => (await (await fetch(`${origin}/api/progress/${encodeURIComponent(folder)}/${encodeURIComponent(name)}`)).json()).page;

let saved = null;
let unsaved = null;
for (const file of list) {
  const state = await stateOf(file.name);
  if (!saved && state?.page > 1) saved = { name: file.name, page: state.page, progressPage: await progressOf(file.name) };
  if (!unsaved && !(state?.page > 1)) unsaved = { name: file.name, page: state?.page ?? null, progressPage: await progressOf(file.name) };
  if (saved && unsaved) break;
}
results.expected = { saved, unsaved, books: list.length };
if (!saved) {
  results.verdict = 'SKIP';
  results.reason = '저장 페이지가 1보다 큰 책이 라이브러리에 없어 검증할 수 없다';
  await writeFile(new URL('result.json', output), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

const browser = await chromium.launch({ headless: true, ...(process.env.PDFIT_TEST_CHANNEL ? { channel: process.env.PDFIT_TEST_CHANNEL } : {}) });
const writes = [];
try {
  const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (request.method() !== 'GET' && request.method() !== 'HEAD' && !request.url().endsWith('/api/folders/refresh')) writes.push(`${request.method()} ${new URL(request.url()).pathname}`); });
  await page.goto(`${origin}/folder/${encodeURIComponent(folder)}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '표지 보기', exact: true }).click();
  await page.getByTestId('pdf-cover-card').first().waitFor({ timeout: 30000 });

  const overlayLastPage = async (name) => {
    const title = name.replace(/\.pdf$/i, '');
    const card = page.getByTestId('pdf-cover-card').filter({ hasText: title }).first();
    await card.scrollIntoViewIfNeeded();
    await page.mouse.move(2, 2);
    await card.getByTestId('pdf-cover-media').hover();
    const locator = card.getByTestId('pdf-cover-last-page');
    await locator.waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1500);
    return { text: (await locator.innerText()).trim(), card };
  };

  const savedResult = await overlayLastPage(saved.name);
  await page.screenshot({ path: shot('saved-book-overlay.png') });
  const unsavedResult = unsaved ? await overlayLastPage(unsaved.name) : null;
  results.observed = { saved: savedResult.text, unsaved: unsavedResult?.text ?? null, pageErrors: errors, nonGetRequests: writes };

  assert.equal(savedResult.text.replace(/\D+/g, ''), String(saved.page), `저장 페이지가 ${saved.page}인 책의 오버레이가 그 값을 보여야 한다: "${savedResult.text}"`);
  if (unsavedResult) assert.ok(/—/.test(unsavedResult.text), `저장 기록이 없는 책은 "—"여야 한다: "${unsavedResult.text}"`);
  assert.equal(errors.length, 0, `pageerror가 없어야 한다: ${errors.join(' | ')}`);
  assert.equal(writes.length, 0, `읽기 전용이어야 한다: ${writes.join(', ')}`);
  results.verdict = 'PASS';
} catch (error) {
  results.verdict = 'FAIL';
  results.failure = String(error?.message ?? error).slice(0, 1200);
  process.exitCode = 1;
} finally {
  await writeFile(new URL('result.json', output), JSON.stringify(results, null, 2));
  await browser.close();
  console.log(JSON.stringify(results, null, 2));
}
