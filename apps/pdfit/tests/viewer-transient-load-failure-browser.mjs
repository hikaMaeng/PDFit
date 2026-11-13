// 일시적 로드 실패 후 복구 검증 (배포된 Free 서버 대상, PDF.js 기본 뷰어).
// 사용자 보고: 스크롤 등으로 페이지를 넘기다 보면 페이지가 하얗게 되고 다시는 복구되지 않는다
// (콘솔에 PDF 요청 502). 기대: 서버가 다시 응답하면 사용자 조작 없이 그 페이지가 그려진다.
// 방법: 큰 책을 연 뒤 PDF 구간(Range) 요청만 502 로 바꾸고 목표 페이지로 이동, 실패를 해제하고
// 기다린 뒤 그 페이지 캔버스의 픽셀이 흰색만이 아닌지 본다. GET 이외 요청은 모두 막는다.
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const folder = process.env.PDFIT_TEST_FOLDER ?? '이북';
const book = process.env.PDFIT_TEST_BOOK ?? '밑바닥부터 시작하는 딥러닝.pdf';
const targetPage = Number(process.env.PDFIT_TEST_PAGE ?? 79);
const runId = process.env.PDFIT_TEST_RUN ?? 'local';
const channel = process.env.PDFIT_TEST_CHANNEL || undefined;
const recoverWaitMs = Number(process.env.PDFIT_TEST_RECOVER_MS ?? 15000);
// 'single' or 'double' (the user's report was in two-page view).
const layout = process.env.PDFIT_TEST_LAYOUT === 'double' ? 'double' : 'single';
const output = new URL(`./reports/viewer-transient-load-failure/${runId}/`, import.meta.url);
await mkdir(output, { recursive: true });
const shot = (name) => decodeURIComponent(new URL(name, output).pathname.slice(1));

const results = { origin, folder, book, targetPage, layout, runId, channel: channel ?? 'playwright-bundled', recoverWaitMs, failedRanges: 0, blockedWrites: [], pageErrors: [], checks: [] };
const check = (name, pass, detail) => { results.checks.push({ name, pass, ...detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`); };

let failRanges = false;
const browser = await chromium.launch({ headless: true, channel });
const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 1000 } });
await context.route('**/*', async (route) => {
  const request = route.request();
  if (request.method() !== 'GET' && request.method() !== 'HEAD') {
    results.blockedWrites.push(`${request.method()} ${new URL(request.url()).pathname}`);
    return route.abort();
  }
  const isPdf = /\/api\/folders\/.+\.pdf/i.test(decodeURIComponent(new URL(request.url()).pathname));
  if (failRanges && isPdf && request.headers().range) {
    results.failedRanges += 1;
    return route.fulfill({ status: 502, body: 'Bad Gateway' });
  }
  return route.continue();
});
const page = await context.newPage();
page.on('pageerror', (error) => results.pageErrors.push(error.message));
const passiveWarnings = [];
page.on('console', (message) => { if (/passive event listener/i.test(message.text())) passiveWarnings.push(message.text()); });

// Ratio of non-white pixels in the canvas of a page shell (1-based page number).
const inkOf = (pageNumber) => page.evaluate((index) => {
  const canvas = document.querySelector(`[data-page-index="${index}"] canvas`);
  if (!(canvas instanceof HTMLCanvasElement) || !canvas.width || !canvas.height) return { ink: null, state: canvas?.dataset.renderState ?? null };
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let ink = 0;
  // Unpainted canvas pixels are transparent (0,0,0,0); only opaque non-white pixels count as ink.
  for (let i = 0; i < data.length; i += 4 * 7) if (data[i + 3] > 0 && (data[i] < 235 || data[i + 1] < 235 || data[i + 2] < 235)) ink += 1;
  return { ink: ink / (data.length / (4 * 7)), state: canvas.dataset.renderState ?? null, source: canvas.dataset.renderSource ?? null };
}, pageNumber - 1);

try {
  const url = `${origin}/viewer/${encodeURIComponent(folder)}/${encodeURIComponent(book)}?page=1`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-legacy-page-shell="true"]').first().waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: layout === 'double' ? '두 페이지 보기' : '한 페이지 보기', exact: true }).click();
  await page.waitForTimeout(1500);
  const firstInk = await inkOf(1);
  check('control: page 1 paints before any failure', (firstInk.ink ?? 0) > 0.001, firstInk);

  // Page-mode wheel paging calls preventDefault; with React's passive onWheel Chrome logged
  // "Unable to preventDefault inside passive event listener invocation" for every tick.
  const surface = page.getByTestId('legacy-bookmark-capture-surface');
  const box = await surface.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let tick = 0; tick < 6; tick += 1) { await page.mouse.wheel(0, 120); await page.waitForTimeout(60); }
  await page.waitForTimeout(800);
  const pageAfterWheel = await page.getByRole('textbox', { name: '페이지 번호' }).inputValue();
  check('page-mode wheel logs no passive-listener preventDefault error', passiveWarnings.length === 0, { passiveWarnings: passiveWarnings.length, pageAfterWheel });

  failRanges = true;
  const pageInput = page.getByRole('textbox', { name: '페이지 번호' });
  await pageInput.fill(String(targetPage));
  await pageInput.press('Enter');
  await page.waitForTimeout(4000);
  const duringFailure = await inkOf(targetPage);
  results.duringFailure = duringFailure;
  await page.screenshot({ path: shot('during-failure.png') });
  check('failure injected: range requests answered 502', results.failedRanges > 0, { failedRanges: results.failedRanges, duringFailure });

  failRanges = false;
  const deadline = Date.now() + recoverWaitMs;
  let after = await inkOf(targetPage);
  while (Date.now() < deadline && !((after.ink ?? 0) > 0.001)) {
    await page.waitForTimeout(500);
    after = await inkOf(targetPage);
  }
  results.afterRecovery = after;
  await page.screenshot({ path: shot('after-recovery.png') });
  check(`page ${targetPage} paints within ${recoverWaitMs} ms after the server recovers, without user action`, (after.ink ?? 0) > 0.001, after);
} catch (error) {
  results.error = error instanceof Error ? error.stack : String(error);
  await page.screenshot({ path: shot('error.png') }).catch(() => {});
} finally {
  await browser.close();
}
results.verdict = !results.error && results.checks.length > 0 && results.checks.every((item) => item.pass) && results.pageErrors.length === 0 ? 'PASS' : 'FAIL';
await writeFile(new URL('result.json', output), `${JSON.stringify(results, null, 2)}\n`);
console.log(`verdict ${results.verdict}; failed ranges ${results.failedRanges}; page errors ${results.pageErrors.length}`);
if (results.error) console.log(results.error);
process.exit(results.verdict === 'PASS' ? 0 : 1);
