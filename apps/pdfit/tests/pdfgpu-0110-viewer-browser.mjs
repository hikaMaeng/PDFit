// @pdfgpu/core 0.1.10 반영 검증 (배포된 Free 서버 대상).
// - 기본(PDF.js) 뷰어: 양쪽 보기 짝을 읽는 사람이 바꿀 수 있고 어느 쪽이든 페이지가 겹치지 않는다.
// - GPU 뷰어(?engine=gpu): PDFium Web Worker가 뜨고, 키 한 번에 한 페이지만 넘어간다.
// 서재 데이터를 바꾸지 않도록 GET/HEAD 이외의 요청은 모두 막고 막은 목록을 기록한다.
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const folder = process.env.PDFIT_TEST_FOLDER ?? '이북';
const runId = process.env.PDFIT_TEST_RUN ?? 'local';
const channel = process.env.PDFIT_TEST_CHANNEL || undefined;
const gpuArgs = process.env.PDFIT_TEST_WEBGPU === '1' ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU'] : [];
const output = new URL(`./reports/pdfgpu-0110-integration/${runId}/`, import.meta.url);
await mkdir(output, { recursive: true });
const shot = (name) => decodeURIComponent(new URL(name, output).pathname.slice(1));

const results = { origin, folder, runId, channel: channel ?? 'playwright-bundled', launchArgs: gpuArgs, checks: [], blockedWrites: [], pageErrors: [] };
const check = (name, pass, detail) => { results.checks.push({ name, pass, ...detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`); };

const files = await (await fetch(`${origin}/api/folders/${encodeURIComponent(folder)}/files`)).json();
const list = (Array.isArray(files) ? files : files.files).filter((file) => /\.pdf$/i.test(file.name));
// Smallest books first so loading stays short; the first one with at least 8 pages is used.
list.sort((a, b) => (a.size ?? 0) - (b.size ?? 0));

const browser = await chromium.launch({ headless: true, channel, args: gpuArgs });
const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 1000 } });
await context.route('**/*', (route) => {
  const request = route.request();
  if (request.method() === 'GET' || request.method() === 'HEAD') return route.continue();
  results.blockedWrites.push(`${request.method()} ${new URL(request.url()).pathname}`);
  return route.abort();
});
const page = await context.newPage();
page.on('pageerror', (error) => results.pageErrors.push(error.message));
const workers = [];
page.on('worker', (worker) => workers.push(worker.url()));

const viewerUrl = (name, query = '') => `${origin}/viewer/${encodeURIComponent(folder)}/${encodeURIComponent(name)}${query}`;
const legacyShells = async () => page.locator('[data-legacy-page-shell="true"]').evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('data-page-index')) + 1).sort((a, b) => a - b));
const legacyTotal = async () => {
  const text = await page.locator('body').innerText();
  const match = text.match(/\/\s*(\d+)\s*$/m) ?? text.match(/\/\s*(\d+)/);
  return match ? Number(match[1]) : 0;
};

try {
  // ── 기본(PDF.js) 뷰어 ──────────────────────────────────────
  let book = null;
  for (const file of list.slice(0, 12)) {
    await page.goto(viewerUrl(file.name), { waitUntil: 'domcontentloaded' });
    await page.locator('[data-legacy-page-shell="true"]').first().waitFor({ timeout: 60000 });
    const total = await legacyTotal();
    if (total >= 8) { book = { name: file.name, total }; break; }
  }
  if (!book) throw new Error('8쪽 이상인 책을 찾지 못했다');
  results.book = book;

  // 저장된 읽기 위치와 무관하게 1쪽에서 시작한다.
  await page.goto(viewerUrl(book.name, '?page=1'), { waitUntil: 'domcontentloaded' });
  await page.locator('[data-legacy-page-shell="true"]').first().waitFor({ timeout: 60000 });
  await page.evaluate(() => { try { localStorage.removeItem('pdfit.viewer.spreadCover'); } catch { /* ignore */ } });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-legacy-page-shell="true"]').first().waitFor({ timeout: 60000 });

  await page.getByRole('button', { name: '두 페이지 보기', exact: true }).click();
  await page.waitForTimeout(800);
  const next = page.getByRole('button', { name: '다음 페이지', exact: true });
  const prev = page.getByRole('button', { name: '이전 페이지', exact: true });
  const settle = () => page.waitForTimeout(700);

  const pairedRows = [await legacyShells()];
  await next.click(); await settle(); pairedRows.push(await legacyShells());
  await next.click(); await settle(); pairedRows.push(await legacyShells());
  await prev.click(); await settle(); pairedRows.push(await legacyShells());
  check('legacy paired rows (default)', JSON.stringify(pairedRows) === JSON.stringify([[1, 2], [3, 4], [5, 6], [3, 4]]), { rows: pairedRows, expected: [[1, 2], [3, 4], [5, 6], [3, 4]] });
  await page.screenshot({ path: shot('legacy-paired.png') });

  const toggle = page.getByTestId('spread-cover-alone');
  await prev.click(); await settle();
  await toggle.click(); await settle();
  const aloneRows = [await legacyShells()];
  await next.click(); await settle(); aloneRows.push(await legacyShells());
  await next.click(); await settle(); aloneRows.push(await legacyShells());
  await prev.click(); await settle(); aloneRows.push(await legacyShells());
  await page.mouse.click(5, 500);
  await page.keyboard.press('PageDown'); await settle(); aloneRows.push(await legacyShells());
  await page.keyboard.press('PageUp'); await settle(); aloneRows.push(await legacyShells());
  const aloneExpected = [[1], [2, 3], [4, 5], [2, 3], [4, 5], [2, 3]];
  check('legacy cover-alone rows (button, PageDown, PageUp)', JSON.stringify(aloneRows) === JSON.stringify(aloneExpected), { rows: aloneRows, expected: aloneExpected, pressed: await toggle.getAttribute('aria-pressed') });
  await page.screenshot({ path: shot('legacy-cover-alone.png') });

  await toggle.click(); await settle();
  const backToPaired = await legacyShells();
  check('legacy toggle back to paired keeps the current pages in one row', JSON.stringify(backToPaired) === JSON.stringify([[1, 2], [3, 4]].find((row) => row.includes(aloneRows.at(-1)[0])) ?? []), { row: backToPaired, from: aloneRows.at(-1) });

  await toggle.click(); await settle();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-legacy-page-shell="true"]').first().waitFor({ timeout: 60000 });
  // Viewer-state writes are blocked, so the reload comes back in the saved layout; the toggle
  // only exists in two-page mode, so enter it again before reading the remembered choice.
  await page.getByRole('button', { name: '두 페이지 보기', exact: true }).click();
  await settle();
  const persistedPressed = await page.getByTestId('spread-cover-alone').getAttribute('aria-pressed', { timeout: 10000 }).catch(() => null);
  const persistedRow = await legacyShells();
  check('legacy pairing choice survives reload (localStorage)', persistedPressed === 'true' && persistedRow.length === 1 && persistedRow[0] === 1, { ariaPressed: persistedPressed, row: persistedRow, expectedRow: [1] });

  // ── GPU 뷰어 ──────────────────────────────────────────────
  const gpuPageText = async () => {
    const text = await page.locator('body').innerText();
    const match = text.match(/Pages:\s*(\d+)\s*\/\s*(\d+)/);
    return match ? { page: Number(match[1]), total: Number(match[2]) } : null;
  };
  const backendText = async () => (await page.locator('body').innerText()).match(/Backend:\s*([\w-]+)/)?.[1] ?? null;
  workers.length = 0;
  await page.goto(viewerUrl(book.name, '?engine=gpu&page=1'), { waitUntil: 'domcontentloaded' });
  const area = page.getByTestId('pdfgpu-scroll-area');
  await area.waitFor({ timeout: 60000 });
  await page.waitForFunction(() => /Pages:\s*\d+\s*\/\s*[1-9]/.test(document.body.innerText), null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  const backend = await backendText();
  results.gpu = { backend, workers: [...workers] };
  check('gpu viewer starts PDFium worker', workers.some((url) => /pdfiumWorkerMain/.test(url)), { workers, backend });
  const canvasCount = await area.locator('canvas').count();
  check('gpu viewer paints a canvas', canvasCount > 0, { canvasCount, backend });
  await page.screenshot({ path: shot('gpu-viewer.png') });

  // 페이지 모드에서 키를 누른다. 뷰포트에 포커스가 있을 때(pdfgpu 리스너 + PDFit window 리스너) 이중 이동이 없어야 한다.
  const singleButton = page.getByRole('button', { name: '한 페이지 보기', exact: true });
  if (await singleButton.count()) await singleButton.first().click().catch(() => {});
  await page.waitForTimeout(800);
  const continuous = page.getByRole('button', { name: '연속 스크롤', exact: true });
  if (await continuous.count() && (await continuous.first().getAttribute('aria-pressed')) === 'true') await continuous.first().click();
  await page.waitForTimeout(800);
  const state0 = await gpuPageText();
  const viewport = area.locator('[tabindex="0"]').first();
  const focusTarget = (await viewport.count()) ? viewport : area;
  await focusTarget.focus().catch(() => {});
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName ?? null);
  await page.keyboard.press('PageDown'); await page.waitForTimeout(1200);
  const state1 = await gpuPageText();
  check('gpu PageDown with viewport focus moves exactly one page', !!state0 && !!state1 && state1.page === state0.page + 1, { before: state0, after: state1, focused });
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
  await page.keyboard.press('PageDown'); await page.waitForTimeout(1200);
  const state2 = await gpuPageText();
  check('gpu PageDown without viewport focus moves exactly one page', !!state1 && !!state2 && state2.page === state1.page + 1, { before: state1, after: state2 });
} catch (error) {
  results.error = error instanceof Error ? error.stack : String(error);
  await page.screenshot({ path: shot('error.png') }).catch(() => {});
} finally {
  await browser.close();
}

results.verdict = !results.error && results.checks.length > 0 && results.checks.every((item) => item.pass) && results.pageErrors.length === 0 ? 'PASS' : 'FAIL';
await writeFile(new URL('result.json', output), `${JSON.stringify(results, null, 2)}\n`);
console.log(`verdict ${results.verdict}; blocked writes ${results.blockedWrites.length}; page errors ${results.pageErrors.length}`);
if (results.error) console.log(results.error);
process.exit(results.verdict === 'PASS' ? 0 : 1);
