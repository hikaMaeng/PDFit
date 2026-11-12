import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// 페이지 텍스트(뷰어 `page-ocr-open`)와 클립 텍스트(마이클립 `clip-ocr`)를 배포된 Free 서버에서 검증한다.
// 계약: packages/pdfit/docs/api.md "OCR (local runtime)", apps/pdfit/docs/usage.md "Clip and page text (OCR)".
// 실제 라이브러리에 쓴다: 뷰어에서 끌어서 클립 두 개를 만들고 finally에서 지운다. PDF·표지·태그는 건드리지 않는다.
// 읽기 위치·뷰어 상태·주석 쓰기는 가로채 서버로 보내지 않는다(사용자 독서 상태 보존).
// 기대값은 화면 코드가 아니라 서버 API에서 따로 가져온다:
//   페이지 글 = 같은 pageIndex의 `POST /api/ocr/page` 응답, 클립 글 = `GET /api/bookmarks`의 그 클립 `ocr`.
const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const folder = process.env.PDFIT_TEST_FOLDER ?? '이북';
// 디지털(텍스트 층 있음) 후보. 앞에서부터 `POST /api/ocr/page`로 물어 첫 text-layer 파일을 쓴다.
const digitalCandidates = (process.env.PDFIT_TEST_DIGITAL_FILES ?? 'Git for Teams.pdf|인공지능을 위한 수학.pdf').split('|');
const digitalPageIndex = Number(process.env.PDFIT_TEST_DIGITAL_PAGE_INDEX ?? 49);
const scannedFile = process.env.PDFIT_TEST_SCANNED_FILE ?? 'Three.js로 3D 그래픽만들기.pdf';
const scannedCachedIndex = Number(process.env.PDFIT_TEST_SCANNED_CACHED_INDEX ?? 20);
const scannedUncachedIndex = Number(process.env.PDFIT_TEST_SCANNED_UNCACHED_INDEX ?? 30);
// 비전 모델 대기 상한(페이지·클립 각각). 이 AI 서버는 한 장에 10~300 s 걸릴 수 있다.
const visionWaitMs = Number(process.env.PDFIT_TEST_VISION_WAIT_MS ?? 360_000);
// `PDFIT_TEST_SKIP_VISION=1`: 비전 모델을 기다리는 3c·4b를 건너뛴다(SKIP으로 기록). 화면 배치만 다시 볼 때.
const skipVision = process.env.PDFIT_TEST_SKIP_VISION === '1';
const channel = process.env.PDFIT_TEST_CHANNEL ?? 'chrome';
const runId = process.env.PDFIT_TEST_RUN ?? '20261112_ocr';
const locale = 'ko-KR';
const output = new URL(`./reports/ocr/${runId}/`, import.meta.url);
await mkdir(output, { recursive: true });
const shot = (name) => decodeURIComponent(new URL(name, output).pathname.slice(1));

// 화면 문구: packages/pdfit/src/front/i18n/messages.ts의 ko(1번) 값.
const TEXT = {
  ocrPage: '페이지 텍스트 읽기',
  pageTitle: (page) => `${page}페이지 텍스트`,
  slow: '스캔된 페이지는 AI 서버가 읽습니다. 몇 분 걸릴 수 있습니다.',
  sourceTextLayer: 'PDF 텍스트',
  sourceVision: 'AI 인식',
  areaBookmark: '선택 영역 보관',
  pageNumber: '페이지 번호',
  close: '닫기',
};

const startedAt = Date.now();
const elapsed = () => Date.now() - startedAt;
const results = { origin, folder, channel, locale, visionWaitMs, skipVision, startedAtIso: new Date(startedAt).toISOString(), steps: {}, bugs: [], observations: [] };
const VISION_STEPS = new Set(['3c_page_ocr_scanned_uncached', '4b_clip_scanned']);
// `PDFIT_TEST_STEPS=3c,4b`: 이 접두어로 시작하는 단계만 돈다(2단계는 항상). 나머지는 SKIP.
const onlySteps = (process.env.PDFIT_TEST_STEPS ?? '').split(',').map((item) => item.trim()).filter(Boolean);
results.onlySteps = onlySteps;
const runStep = async (name, fn) => {
  const begun = elapsed();
  if (onlySteps.length && !name.startsWith('2_') && !onlySteps.some((prefix) => name.startsWith(prefix))) { results.steps[name] = { verdict: 'SKIP', reason: `PDFIT_TEST_STEPS=${onlySteps.join(',')}` }; console.log(`${name}: SKIP`); return results.steps[name]; }
  if (skipVision && VISION_STEPS.has(name)) { results.steps[name] = { verdict: 'SKIP', reason: 'PDFIT_TEST_SKIP_VISION=1' }; console.log(`${name}: SKIP`); return results.steps[name]; }
  try {
    const value = await fn();
    results.steps[name] = { verdict: 'PASS', ...value, stepMs: elapsed() - begun };
  } catch (error) {
    results.steps[name] = { verdict: 'FAIL', ...(error?.partial ?? {}), error: String(error?.stack ?? error).slice(0, 1500), stepMs: elapsed() - begun };
    results.verdict = 'FAIL';
    process.exitCode = 1;
  }
  console.log(`[${(elapsed() / 1000).toFixed(1)}s] ${name}: ${results.steps[name].verdict}`);
  return results.steps[name];
};
// 단계 안에서 실패해도 그때까지 모은 값을 남긴다.
const failWith = (message, partial) => Object.assign(new Error(message), { partial });

const api = async (path, init) => {
  const response = await fetch(new URL(path, origin), init);
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body };
};
const pageOcrApi = async (filename, pageIndex) => {
  const begun = Date.now();
  const result = await api('/api/ocr/page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder, filename, pageIndex }) });
  return { ...result, wallMs: Date.now() - begun };
};
const listBookmarks = async () => {
  const result = await api('/api/bookmarks');
  assert.equal(result.status, 200, `GET /api/bookmarks → ${result.status}`);
  return result.body;
};
// 스크린샷 실패는 단계 판정을 바꾸지 않고 observations에 남긴다.
const snap = async (target, name) => { try { await target.screenshot({ path: shot(name), timeout: 15_000 }); } catch (error) { results.observations.push(`screenshot ${name} failed: ${String(error?.message ?? error).split('\n')[0]}`); } };
const squash = (text) => String(text ?? '').replace(/\s+/g, '');

// ── 전제: 시작 시점 클립 목록 ─────────────────────────────
const baseline = await listBookmarks();
results.baseline = { bookmarks: baseline.length, ids: baseline.map((item) => item.id).sort() };
const created = new Set();

// 2. 디지털 PDF 찾기
let digitalFile = null;
await runStep('2_find_digital_pdf', async () => {
  const probes = [];
  for (const filename of digitalCandidates) {
    const probe = await pageOcrApi(filename, digitalPageIndex);
    const text = probe.body?.text ?? '';
    probes.push({ filename, pageIndex: digitalPageIndex, status: probe.status, source: probe.body?.source, cached: probe.body?.cached, pageCount: probe.body?.pageCount, durationMs: probe.body?.durationMs, wallMs: probe.wallMs, chars: text.length, nonBlankChars: squash(text).length, head: text.slice(0, 80) });
    if (probe.status === 200 && probe.body.source === 'text-layer' && squash(text).length >= 200) { digitalFile = filename; break; }
  }
  if (!digitalFile) throw failWith('text-layer 디지털 PDF를 찾지 못했다', { probes });
  return { chosen: digitalFile, pageIndex: digitalPageIndex, probes };
});

const browser = await chromium.launch({ headless: true, ...(channel === 'bundled' ? {} : { channel }) });
const pageErrors = [];
const blockedWrites = [];
const allowedWrites = [];
const consoleErrors = [];
// 허용하는 쓰기: OCR 요청, 클립 만들기·지우기·다시 읽기, 표시 이름 번역, 폴더 새로 읽기. 나머지 비GET은 가로채 {}를 준다.
const allowedWrite = (method, pathname) => (method === 'POST' && pathname === '/api/ocr/page')
  || (method === 'POST' && /^\/api\/bookmarks\/[^/]+\/[^/]+$/.test(pathname) && !pathname.endsWith('/ocr'))
  || (method === 'POST' && /^\/api\/bookmarks\/[^/]+\/ocr$/.test(pathname))
  || (method === 'DELETE' && /^\/api\/bookmarks\/[^/]+$/.test(pathname))
  || (method === 'POST' && pathname === '/api/settings/translations')
  || (method === 'POST' && pathname === '/api/folders/refresh');
const isCreateClip = (method, pathname) => method === 'POST' && /^\/api\/bookmarks\/[^/]+\/[^/]+$/.test(pathname) && !pathname.endsWith('/ocr');

const newContext = async (options, { mode, label }) => {
  const context = await browser.newContext({ locale, permissions: ['clipboard-read', 'clipboard-write'], ...options });
  await context.addInitScript(({ mode }) => {
    try { window.localStorage.setItem('pdfit.color-mode', mode); window.localStorage.setItem('pdfit.language', 'ko'); } catch { /* ignore */ }
  }, { mode });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.origin !== new URL(origin).origin || method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return route.continue();
    if (allowedWrite(method, url.pathname)) { allowedWrites.push(`${label} ${method} ${decodeURIComponent(url.pathname)} @${elapsed()}`); return route.continue(); }
    blockedWrites.push(`${label} ${method} ${decodeURIComponent(url.pathname)}`);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  context.on('response', async (response) => {
    const request = response.request();
    const url = new URL(request.url());
    if (!isCreateClip(request.method(), url.pathname)) return;
    const body = await response.json().catch(() => null);
    if (body?.id) created.add(body.id);
  });
  return context;
};
const watch = (page, label) => {
  page.on('pageerror', (error) => pageErrors.push(`${label}: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(`${label}: ${message.text().slice(0, 300)}`); });
};

const viewerPath = (filename, page) => `/viewer/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}${page ? `?page=${page}` : ''}`;
// 뷰어를 열고 페이지 번호 칸으로 그 페이지에 간다.
const openViewerAt = async (page, filename, pageNumber) => {
  await page.bringToFront();
  await page.goto(`${origin}${viewerPath(filename)}`, { waitUntil: 'domcontentloaded' });
  const input = page.getByRole('textbox', { name: TEXT.pageNumber });
  await input.waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForFunction(() => document.querySelector('[data-pdf-page] canvas'), null, { timeout: 60_000 });
  await input.fill(String(pageNumber));
  await input.press('Enter');
  await page.waitForFunction(({ name, value }) => [...document.querySelectorAll('input')].some((node) => node.getAttribute('aria-label') === name && node.value === value), { name: TEXT.pageNumber, value: String(pageNumber) }, { timeout: 30_000 }).catch(() => undefined);
  // 보고된 뷰어 상태(latestViewerStateRef)가 따라오도록 잠깐 둔다.
  await page.waitForTimeout(1500);
  return input.inputValue();
};

// page-ocr 패널 상태를 250 ms마다 읽어 시간표로 남긴다. 끝 상태(done/failed/unavailable)나 시간 초과까지.
const watchPanel = async (page, prefix, limitMs, { stopOnFinal = true } = {}) => {
  const begun = Date.now();
  const timeline = [];
  let last = null;
  let slowHintAtMs = null;
  while (Date.now() - begun < limitMs) {
    const now = await page.evaluate(({ prefix, slow }) => {
      const panel = document.querySelector(`[data-testid="${prefix}"]`);
      if (!panel) return { status: 'absent' };
      return { status: panel.getAttribute('data-ocr-status'), slowHint: panel.textContent.includes(slow) };
    }, { prefix, slow: TEXT.slow }).catch(() => ({ status: 'error' }));
    const at = Date.now() - begun;
    if (now.slowHint && slowHintAtMs === null) slowHintAtMs = at;
    if (!last || last.status !== now.status || last.slowHint !== now.slowHint) timeline.push({ atMs: at, ...now });
    last = now;
    if (stopOnFinal && ['done', 'failed', 'unavailable'].includes(now.status)) break;
    await page.waitForTimeout(250);
  }
  return { timeline, final: last?.status ?? null, finalAtMs: timeline.at(-1)?.atMs ?? null, slowHintAtMs, waitedMs: Date.now() - begun };
};
const readPanel = (page, prefix) => page.evaluate((prefix) => {
  const q = (suffix) => document.querySelector(`[data-testid="${prefix}${suffix}"]`);
  return {
    status: q('')?.getAttribute('data-ocr-status') ?? null,
    text: q('-text')?.textContent ?? null,
    source: q('-source')?.getAttribute('data-source') ?? null,
    sourceLabel: q('-source')?.textContent ?? null,
    copy: Boolean(q('-copy')),
    retry: Boolean(q('-retry')),
    retryDisabled: q('-retry')?.disabled ?? null,
    unavailable: q('-unavailable')?.textContent ?? null,
    failed: q('-failed')?.textContent ?? null,
    empty: q('-empty')?.textContent ?? null,
  };
}, prefix);

// 헤더 버튼으로 페이지 텍스트 대화상자를 열고 그 요청·응답을 함께 잡는다.
const openPageOcr = async (page) => {
  const requestSeen = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/ocr/page', { timeout: 15_000 });
  const button = page.getByTestId('page-ocr-open');
  await button.waitFor({ state: 'visible', timeout: 15_000 });
  const ariaLabel = await button.getAttribute('aria-label');
  await button.click();
  const dialog = page.getByTestId('page-ocr-dialog');
  await dialog.waitFor({ state: 'visible', timeout: 10_000 });
  const request = await requestSeen;
  const requestBody = JSON.parse(request.postData() ?? '{}');
  const title = (await page.locator('#page-ocr-dialog-title').innerText()).trim();
  const roleDialog = await page.getByRole('dialog', { name: title }).count();
  return { dialog, request, requestBody, title, roleDialog, ariaLabel };
};
// 응답을 최대 limitMs만 기다린다. 화면 관찰이 끝났는데 서버가 아직 답하지 않으면 `pendingAfterMs`로 남긴다.
const responseOf = async (request, limitMs = 15_000) => {
  const response = await Promise.race([request.response().catch(() => null), new Promise((resolve) => setTimeout(() => resolve('timeout'), limitMs))]);
  if (response === 'timeout') return { status: null, body: null, failure: null, pendingAfterMs: limitMs };
  if (!response) return { status: null, body: null, failure: request.failure()?.errorText ?? null };
  return { status: response.status(), body: await response.json().catch(() => null) };
};
const closeDialog = async (page, dialog) => {
  await dialog.getByRole('button', { name: TEXT.close }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
};

// 뷰어에서 "선택 영역 보관" 도구로 페이지 위를 끌어 클립을 만든다(실제 캡처 경로: PdfViewer handleCapturePointerUp).
const captureClip = async (page, filename, pageNumber, region) => {
  const tool = page.getByRole('button', { name: TEXT.areaBookmark, exact: true });
  await tool.click();
  const canvas = page.locator(`[data-pdf-page][data-page-number="${pageNumber}"] canvas`).first();
  await canvas.waitFor({ state: 'visible', timeout: 30_000 });
  const surface = await page.getByTestId('legacy-bookmark-capture-surface').boundingBox();
  const box = await canvas.boundingBox();
  const top = Math.max(box.y, surface.y) ;
  const bottom = Math.min(box.y + box.height, surface.y + surface.height);
  const from = { x: box.x + box.width * region.x0, y: top + (bottom - top) * region.y0 };
  const to = { x: box.x + box.width * region.x1, y: top + (bottom - top) * region.y1 };
  const createResponse = page.waitForResponse((response) => isCreateClip(response.request().method(), new URL(response.url()).pathname), { timeout: 30_000 });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i += 1) await page.mouse.move(from.x + (to.x - from.x) * i / 10, from.y + (to.y - from.y) * i / 10);
  await page.mouse.up();
  const response = await createResponse;
  const requestBody = JSON.parse(response.request().postData() ?? '{}');
  const body = await response.json();
  if (body?.id) created.add(body.id);
  // 이후 끌기가 다시 클립을 만들지 않도록 도구를 끈다.
  await tool.click().catch(() => undefined);
  // 화면 좌표 → PDF 점(기대 rect): canvas 표시 크기 ÷ 1배 viewport 크기. 비교용으로 기록만 한다.
  return {
    status: response.status(),
    id: body?.id ?? null,
    ocr: body?.ocr ?? null,
    pageIndex: body?.pageIndex,
    rect: requestBody.rect,
    imageMimeType: requestBody.imageMimeType,
    imageBase64Chars: requestBody.imageBase64?.length ?? 0,
    drag: { from, to, canvas: box },
  };
};

// 마이클립 카드 배지(data-ocr-status)를 클립 id별로 200 ms마다 기록한다. 카드 이미지 주소 /api/bookmark-assets/<id>로 id를 안다.
const installBadgeRecorder = (page) => page.evaluate(() => {
  const started = performance.now();
  window.__badgeTimeline = [];
  const last = new Map();
  window.__badgeTimer = window.setInterval(() => {
    for (const card of document.querySelectorAll('[data-testid="bookmark-library-card"]')) {
      const src = card.querySelector('img')?.getAttribute('src') ?? '';
      const match = /\/api\/bookmark-assets\/([^/?#]+)/.exec(src);
      if (!match) continue;
      const id = decodeURIComponent(match[1]);
      const status = card.querySelector('[data-testid="bookmark-card-ocr"]')?.getAttribute('data-ocr-status') ?? 'none';
      if (last.get(id) !== status) { last.set(id, status); window.__badgeTimeline.push({ id, status, atMs: Math.round(performance.now() - started) }); }
    }
  }, 200);
});
const badgeTimeline = (page, id) => page.evaluate((id) => (window.__badgeTimeline ?? []).filter((item) => item.id === id), id);
const badgeOf = (page, id) => page.locator('[data-testid="bookmark-library-card"]').filter({ has: page.locator(`img[src*="${encodeURIComponent(id)}"]`) }).first();
const waitBadge = async (page, id, statuses, limitMs) => {
  const begun = Date.now();
  while (Date.now() - begun < limitMs) {
    const status = await badgeOf(page, id).locator('[data-testid="bookmark-card-ocr"]').getAttribute('data-ocr-status').catch(() => null);
    if (statuses.includes(status)) return { status, waitedMs: Date.now() - begun };
    await page.waitForTimeout(250);
  }
  return { status: await badgeOf(page, id).locator('[data-testid="bookmark-card-ocr"]').getAttribute('data-ocr-status').catch(() => null), waitedMs: Date.now() - begun, timedOut: true };
};
// 마이클립 탭의 GET /api/bookmarks 시각(폴링 간격 근거).
const trackListPolls = (page) => {
  const polls = [];
  page.on('request', (request) => { if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/bookmarks') polls.push(elapsed()); });
  return polls;
};
const intervals = (times) => times.slice(1).map((value, index) => value - times[index]);

let main = null;
let mainPage = null;
let clipsPage = null;
const extra = [];
try {
  main = await newContext({ viewport: { width: 1440, height: 1000 } }, { mode: 'light', label: 'main' });
  mainPage = await main.newPage();
  watch(mainPage, 'viewer');

  // ── 3a. 디지털 PDF 페이지 텍스트 ─────────────────────────
  const digitalPage = digitalPageIndex + 1;
  let digitalPageText = null;
  await runStep('3a_page_ocr_digital', async () => {
    if (!digitalFile) throw new Error('2단계에서 디지털 PDF를 고르지 못했다');
    const shownPage = await openViewerAt(mainPage, digitalFile, digitalPage);
    const opened = await openPageOcr(mainPage);
    const panel = await watchPanel(mainPage, 'page-ocr', 60_000);
    const ui = await readPanel(mainPage, 'page-ocr');
    const browserResponse = await responseOf(opened.request);
    const duration = await mainPage.getByTestId('page-ocr-duration').innerText().catch(() => null);
    const expected = await pageOcrApi(digitalFile, digitalPageIndex);
    digitalPageText = expected.body?.text ?? null;
    // 복사: 버튼을 누르고 클립보드를 읽는다(헤드리스 권한 부여).
    let clipboard = null;
    if (ui.copy) {
      await mainPage.getByTestId('page-ocr-copy').click();
      clipboard = await mainPage.evaluate(() => navigator.clipboard.readText()).catch((error) => `ERR ${error.message}`);
    }
    await snap(mainPage, 'page-ocr-digital-light.png');
    const partial = { filename: digitalFile, pageNumberInput: shownPage, title: opened.title, ariaLabel: opened.ariaLabel, roleDialog: opened.roleDialog, requestBody: opened.requestBody, browserResponse: { status: browserResponse.status, source: browserResponse.body?.source, cached: browserResponse.body?.cached, durationMs: browserResponse.body?.durationMs, chars: browserResponse.body?.text?.length }, panel, ui: { ...ui, text: undefined, textChars: ui.text?.length ?? null }, durationLabel: duration, expected: { status: expected.status, source: expected.body?.source, cached: expected.body?.cached, chars: expected.body?.text?.length, durationMs: expected.body?.durationMs }, textEqualsApi: ui.text === expected.body?.text, clipboardEqualsText: typeof clipboard === 'string' && clipboard.replace(/\r\n/g, '\n') === ui.text, clipboardChars: typeof clipboard === 'string' ? clipboard.length : null };
    try {
      assert.equal(shownPage, String(digitalPage), '페이지 번호 칸');
      assert.equal(opened.ariaLabel, TEXT.ocrPage, '버튼 접근 이름');
      assert.equal(opened.title, TEXT.pageTitle(digitalPage), '대화상자 제목이 그 페이지 번호');
      assert.equal(opened.roleDialog, 1, '접근 이름이 제목인 dialog 하나');
      assert.deepEqual(opened.requestBody, { folder, filename: digitalFile, pageIndex: digitalPageIndex }, '요청 본문 pageIndex = 페이지 - 1');
      assert.equal(panel.final, 'done', '패널 done');
      assert.equal(ui.source, 'text-layer', 'data-source=text-layer');
      assert.equal(ui.sourceLabel, TEXT.sourceTextLayer);
      assert.equal(ui.text, expected.body?.text, '화면 글 = POST /api/ocr/page 글');
      assert.ok(ui.copy, '복사 버튼');
      assert.ok(duration && /^\d+\.\d s$/.test(duration), `소요 시간 표시 ${duration}`);
    } catch (error) { throw failWith(error.message, partial); }
    await closeDialog(mainPage, opened.dialog);
    return partial;
  });

  // ── 4a. 디지털 PDF 클립: 마이클립 탭을 먼저 열어 둔 채 뷰어에서 끌어 만든다 ──
  let digitalClip = null;
  await runStep('4a_clip_digital', async () => {
    if (!digitalFile) throw new Error('디지털 PDF 없음');
    clipsPage = await main.newPage();
    watch(clipsPage, 'clips');
    const polls = trackListPolls(clipsPage);
    await clipsPage.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    await clipsPage.getByTestId('lnb-bookmarks').click();
    await clipsPage.getByTestId('bookmark-library-page').waitFor({ timeout: 30_000 });
    await clipsPage.waitForURL(/\/bookmarks$/);
    await clipsPage.waitForFunction((count) => document.querySelectorAll('[data-testid="bookmark-library-card"]').length >= count, baseline.length, { timeout: 30_000 });
    await installBadgeRecorder(clipsPage);
    await mainPage.bringToFront();
    const captureAt = elapsed();
    const capture = await captureClip(mainPage, digitalFile, digitalPage, { x0: 0.1, y0: 0.3, x1: 0.9, y1: 0.45 });
    digitalClip = capture;
    await clipsPage.bringToFront();
    const done = await waitBadge(clipsPage, capture.id, ['done', 'failed', 'unavailable'], 90_000);
    const timeline = await badgeTimeline(clipsPage, capture.id);
    const server = (await listBookmarks()).find((item) => item.id === capture.id);
    const pollsAfterCapture = polls.filter((at) => at >= captureAt);
    const clipLines = String(server?.ocr?.text ?? '').split('\n').map(squash).filter(Boolean);
    const pageSquashed = squash(digitalPageText);
    const missingLines = clipLines.filter((line) => !pageSquashed.includes(line));
    await snap(badgeOf(clipsPage, capture.id), 'clip-card-digital-done.png');
    // 대화상자: 글과 출처
    await badgeOf(clipsPage, capture.id).click();
    const dialog = clipsPage.getByTestId('bookmark-preview-dialog');
    await dialog.waitFor({ state: 'visible', timeout: 10_000 });
    await clipsPage.getByTestId('clip-ocr').waitFor({ timeout: 10_000 });
    const ui = await readPanel(clipsPage, 'clip-ocr');
    await snap(clipsPage, 'clip-dialog-digital-light.png');
    // 다시 읽기 → pending → done(폴링)
    const retryResponse = clipsPage.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/bookmarks/${encodeURIComponent(capture.id)}/ocr`, { timeout: 15_000 });
    const retryClickAt = elapsed();
    await clipsPage.getByTestId('clip-ocr-retry').click();
    const retry = await retryResponse;
    const retryPanel = await watchPanel(clipsPage, 'clip-ocr', 90_000);
    const retryUi = await readPanel(clipsPage, 'clip-ocr');
    const retryServer = (await listBookmarks()).find((item) => item.id === capture.id);
    const retryPolls = polls.filter((at) => at >= retryClickAt);
    await clipsPage.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
    const partial = {
      filename: digitalFile, page: digitalPage, capture,
      badge: { final: done.status, waitedMs: done.waitedMs, timedOut: done.timedOut ?? false, timeline },
      listPollsAfterCaptureMs: pollsAfterCapture.map((at) => at - captureAt), listPollIntervalsMs: intervals(pollsAfterCapture),
      server: { status: server?.ocr?.status, source: server?.ocr?.source, chars: server?.ocr?.text?.length ?? null, error: server?.ocr?.error, updatedAt: server?.ocr?.updatedAt, text: server?.ocr?.text },
      subset: { clipLines: clipLines.length, missingLines, pageChars: digitalPageText?.length ?? null },
      dialog: { ...ui, text: undefined, textChars: ui.text?.length ?? null, textEqualsServer: ui.text === server?.ocr?.text },
      retry: { status: retry.status(), panel: retryPanel, final: { ...retryUi, text: undefined, textChars: retryUi.text?.length ?? null }, serverStatus: retryServer?.ocr?.status, serverUpdatedAt: retryServer?.ocr?.updatedAt, listPollsAfterClickMs: retryPolls.map((at) => at - retryClickAt) },
    };
    try {
      assert.equal(capture.status, 201, '클립 저장 201');
      assert.equal(capture.ocr?.status, 'pending', '201 응답 ocr.status=pending');
      assert.equal(capture.pageIndex, digitalPageIndex);
      assert.equal(done.status, 'done', '배지 done');
      assert.equal(timeline[0]?.status, 'pending', `배지가 pending으로 먼저 보인다 ${JSON.stringify(timeline)}`);
      assert.equal(server?.ocr?.source, 'text-layer');
      assert.ok(clipLines.length > 0, '클립 글이 비어 있지 않다');
      assert.deepEqual(missingLines, [], '클립 글의 모든 줄(공백 제거)이 그 페이지 글(공백 제거) 안에 있다');
      assert.equal(ui.status, 'done');
      assert.equal(ui.source, 'text-layer');
      assert.equal(ui.text, server?.ocr?.text, '대화상자 글 = 서버 ocr.text');
      assert.ok(ui.copy && ui.retry, '복사·다시 읽기 버튼');
      assert.equal(retry.status(), 202, '다시 읽기 202');
      assert.equal(retryPanel.timeline[0]?.status, 'pending', `다시 읽기 직후 pending ${JSON.stringify(retryPanel.timeline)}`);
      assert.equal(retryPanel.final, 'done', '다시 읽기 뒤 done');
      assert.equal(retryUi.text, server?.ocr?.text, '다시 읽은 글 = 처음 글');
    } catch (error) { throw failWith(error.message, partial); }
    return partial;
  });

  // ── 5. 페이지 텍스트 대화상자: 다크, 375 px (디지털 페이지, 캐시됨) ──
  await runStep('5_page_ocr_dark_mobile', async () => {
    if (!digitalFile) throw new Error('디지털 PDF 없음');
    // 3a를 건너뛴 실행에서도 기대 글을 API에서 따로 가져온다.
    if (digitalPageText === null) digitalPageText = (await pageOcrApi(digitalFile, digitalPageIndex)).body?.text ?? null;
    const out = {};
    for (const variant of [
      { name: 'dark', options: { viewport: { width: 1440, height: 1000 } }, mode: 'dark' },
      { name: 'mobile', options: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true }, mode: 'light' },
    ]) {
      const context = await newContext(variant.options, { mode: variant.mode, label: variant.name });
      extra.push(context);
      const page = await context.newPage();
      watch(page, variant.name);
      await page.goto(`${origin}${viewerPath(digitalFile, digitalPage)}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('textbox', { name: TEXT.pageNumber }).waitFor({ state: 'visible', timeout: 60_000 }).catch(() => undefined);
      await page.waitForFunction(() => document.querySelector('[data-pdf-page] canvas'), null, { timeout: 60_000 });
      await page.waitForTimeout(1500);
      const buttonBox = await page.getByTestId('page-ocr-open').boundingBox();
      const opened = await openPageOcr(page);
      const panel = await watchPanel(page, 'page-ocr', 60_000);
      const ui = await readPanel(page, 'page-ocr');
      const geometry = await page.evaluate(() => {
        const paper = document.querySelector('[data-testid="page-ocr-dialog"] .MuiDialog-paper').getBoundingClientRect();
        const text = document.querySelector('[data-testid="page-ocr-text"]');
        // 패널 머리줄(제목 "텍스트", 출처 칩, 복사, 다시 읽기)의 글자 줄 수: 글자 노드 Range의 서로 다른 top 수.
        const lines = (node) => {
          if (!node) return null;
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
          const tops = new Set();
          for (let t = walker.nextNode(); t; t = walker.nextNode()) {
            if (!t.textContent.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(t);
            for (const rect of range.getClientRects()) if (rect.width > 0) tops.add(Math.round(rect.top));
          }
          return tops.size;
        };
        const headerLines = { heading: lines(document.getElementById('page-ocr-heading')), source: lines(document.querySelector('[data-testid="page-ocr-source"]')), copy: lines(document.querySelector('[data-testid="page-ocr-copy"]')), retry: lines(document.querySelector('[data-testid="page-ocr-retry"]')) };
        return { viewport: window.innerWidth, paperLeft: Math.round(paper.left), paperRight: Math.round(paper.right), pageOverflow: document.documentElement.scrollWidth - window.innerWidth, textOverflowX: text ? text.scrollWidth - text.clientWidth : null, headerLines, paperBackground: getComputedStyle(document.querySelector('[data-testid="page-ocr-dialog"] .MuiDialog-paper')).backgroundColor };
      });
      await snap(page, `page-ocr-digital-${variant.name}.png`);
      out[variant.name] = { title: opened.title, buttonBox, panel, source: ui.source, textChars: ui.text?.length ?? null, textEqualsApi: ui.text === digitalPageText, geometry };
      await context.close();
    }
    // 단언은 두 변형을 모두 잰 뒤에 한다(한쪽이 실패해도 다른 쪽 값이 남는다).
    try {
      for (const [name, value] of Object.entries(out)) {
        assert.equal(value.title, TEXT.pageTitle(digitalPage), `${name} 제목`);
        assert.equal(value.panel.final, 'done', `${name} done`);
        assert.ok(value.textEqualsApi, `${name} 글 = API`);
        const geometry = value.geometry;
        assert.ok(geometry.paperLeft >= 0 && geometry.paperRight <= geometry.viewport, `${name} 대화상자가 화면 안 ${JSON.stringify(geometry)}`);
        assert.ok(geometry.pageOverflow <= 0, `${name} 페이지 가로 넘침 없음 ${geometry.pageOverflow}`);
        assert.ok(geometry.textOverflowX === null || geometry.textOverflowX <= 0, `${name} 글 상자 가로 넘침 없음 ${geometry.textOverflowX}`);
        for (const [part, count] of Object.entries(geometry.headerLines)) assert.ok(count === null || count === 1, `${name} 패널 머리줄 "${part}" 글자가 한 줄이어야 한다 ${JSON.stringify(geometry.headerLines)}`);
      }
    } catch (error) { throw failWith(error.message, out); }
    return out;
  });

  // ── 3b. 스캔 PDF 21쪽(pageIndex 20, 캐시됨) ─────────────
  const cachedPage = scannedCachedIndex + 1;
  await runStep('3b_page_ocr_scanned_cached', async () => {
    const shownPage = await openViewerAt(mainPage, scannedFile, cachedPage);
    const opened = await openPageOcr(mainPage);
    const panel = await watchPanel(mainPage, 'page-ocr', 60_000);
    const ui = await readPanel(mainPage, 'page-ocr');
    const browserResponse = await responseOf(opened.request);
    const duration = await mainPage.getByTestId('page-ocr-duration').innerText().catch(() => null);
    const expected = await pageOcrApi(scannedFile, scannedCachedIndex);
    await snap(mainPage, 'page-ocr-scanned-cached-light.png');
    const partial = { filename: scannedFile, pageNumberInput: shownPage, title: opened.title, requestBody: opened.requestBody, browserResponse: { status: browserResponse.status, source: browserResponse.body?.source, cached: browserResponse.body?.cached, durationMs: browserResponse.body?.durationMs, chars: browserResponse.body?.text?.length }, panel, ui: { ...ui, text: undefined, textChars: ui.text?.length ?? null }, durationLabel: duration, expected: { source: expected.body?.source, cached: expected.body?.cached, chars: expected.body?.text?.length }, textEqualsApi: ui.text === expected.body?.text };
    try {
      assert.equal(opened.title, TEXT.pageTitle(cachedPage));
      assert.equal(opened.requestBody.pageIndex, scannedCachedIndex);
      assert.equal(panel.final, 'done');
      assert.equal(ui.source, 'vision');
      assert.equal(ui.sourceLabel, TEXT.sourceVision);
      assert.equal(browserResponse.body?.cached, true, '캐시 경로');
      assert.ok(panel.finalAtMs < 4000, `캐시 경로는 느림 안내(4 s) 전에 끝난다 ${panel.finalAtMs}`);
      assert.equal(panel.slowHintAtMs, null, '느림 안내가 보이지 않는다');
      assert.equal(ui.text, expected.body?.text, '화면 글 = API');
    } catch (error) { throw failWith(error.message, partial); }
    await closeDialog(mainPage, opened.dialog);
    return partial;
  });

  // ── 3c. 스캔 PDF 캐시 안 된 페이지: 느림 안내, 닫고 다시 열기, 비전 결과 ──
  const uncachedPage = scannedUncachedIndex + 1;
  await runStep('3c_page_ocr_scanned_uncached', async () => {
    const shownPage = await openViewerAt(mainPage, scannedFile, uncachedPage);
    // 첫 열기: 느림 안내가 4 s 무렵 나타나는지 본다(최대 8 s 관찰) → 닫기.
    const first = await openPageOcr(mainPage);
    const firstPanel = await watchPanel(mainPage, 'page-ocr', 8_000, { stopOnFinal: true });
    await snap(mainPage, 'page-ocr-scanned-pending-slow-hint.png');
    const firstSettledEarly = ['done', 'failed', 'unavailable'].includes(firstPanel.final);
    await closeDialog(mainPage, first.dialog);
    const firstResponse = await responseOf(first.request);
    // 다시 열기: 새 요청, 다시 pending에서 시작, 끝까지 기다린다.
    const second = await openPageOcr(mainPage);
    const secondOpenedAt = elapsed();
    const secondPanel = await watchPanel(mainPage, 'page-ocr', visionWaitMs);
    const ui = await readPanel(mainPage, 'page-ocr');
    const secondResponse = await responseOf(second.request);
    const duration = await mainPage.getByTestId('page-ocr-duration').innerText().catch(() => null);
    await snap(mainPage, 'page-ocr-scanned-uncached-final.png');
    const expected = ui.status === 'done' ? await pageOcrApi(scannedFile, scannedUncachedIndex) : null;
    const partial = {
      filename: scannedFile, pageNumberInput: shownPage, title: second.title,
      first: { panel: firstPanel, settledEarly: firstSettledEarly, response: { status: firstResponse.status, failure: firstResponse.failure ?? null, cached: firstResponse.body?.cached ?? null } },
      second: { openedAtRunMs: secondOpenedAt, panel: secondPanel, response: { status: secondResponse.status, failure: secondResponse.failure ?? null, pendingAfterMs: secondResponse.pendingAfterMs ?? null, source: secondResponse.body?.source, cached: secondResponse.body?.cached, durationMs: secondResponse.body?.durationMs, chars: secondResponse.body?.text?.length, error: secondResponse.body?.error } },
      ui: { ...ui, text: undefined, textChars: ui.text?.length ?? null, textHead: ui.text?.slice(0, 120) ?? null },
      durationLabel: duration,
      expected: expected ? { source: expected.body?.source, cached: expected.body?.cached, chars: expected.body?.text?.length, wallMs: expected.wallMs } : null,
      textEqualsApi: expected ? ui.text === expected.body?.text : null,
    };
    try {
      assert.equal(second.title, TEXT.pageTitle(uncachedPage));
      assert.ok(!firstSettledEarly, `처음 열기는 8 s 안에 끝나지 않아야 한다(캐시 안 된 스캔 페이지) ${JSON.stringify(firstPanel)}`);
      assert.ok(firstPanel.slowHintAtMs !== null && firstPanel.slowHintAtMs >= 3500 && firstPanel.slowHintAtMs <= 6000, `느림 안내가 ~4 s에 나타난다 ${firstPanel.slowHintAtMs}`);
      assert.equal(secondPanel.timeline[0]?.status, 'pending', '다시 열면 pending에서 시작');
      assert.equal(secondPanel.final, 'done', `비전 결과 done (최종 ${secondPanel.final}, ${ui.failed ?? ''})`);
      assert.equal(ui.source, 'vision');
      assert.equal(ui.text, expected?.body?.text, '화면 글 = API(이제 캐시)');
      assert.equal(expected?.body?.cached, true, '끝난 뒤 API는 캐시를 돌려준다');
    } catch (error) { throw failWith(error.message, partial); }
    await closeDialog(mainPage, second.dialog);
    return partial;
  });

  // ── 4b. 스캔 PDF 클립(21쪽) → 비전. 마이클립을 클립 뒤에 새로 연다(폴링으로 done이 되는지) ──
  await runStep('4b_clip_scanned', async () => {
    const shownPage = await openViewerAt(mainPage, scannedFile, cachedPage);
    const captureAt = elapsed();
    const capture = await captureClip(mainPage, scannedFile, cachedPage, { x0: 0.12, y0: 0.25, x1: 0.88, y1: 0.45 });
    if (!clipsPage) { clipsPage = await main.newPage(); watch(clipsPage, 'clips'); }
    const polls = trackListPolls(clipsPage);
    await clipsPage.bringToFront();
    await clipsPage.goto(`${origin}/bookmarks`, { waitUntil: 'domcontentloaded' });
    await clipsPage.getByTestId('bookmark-library-page').waitFor({ timeout: 30_000 });
    await clipsPage.waitForFunction(() => document.querySelectorAll('[data-testid="bookmark-library-card"]').length > 0, null, { timeout: 30_000 });
    await installBadgeRecorder(clipsPage);
    const firstBadge = await waitBadge(clipsPage, capture.id, ['pending', 'done', 'failed', 'unavailable'], 15_000);
    const cards = clipsPage.getByTestId('bookmark-library-page');
    await snap(cards, 'clips-page-badges-pending.png');
    const done = await waitBadge(clipsPage, capture.id, ['done', 'failed', 'unavailable'], visionWaitMs);
    const timeline = await badgeTimeline(clipsPage, capture.id);
    const server = (await listBookmarks()).find((item) => item.id === capture.id);
    await snap(cards, 'clips-page-badges-final.png');
    await badgeOf(clipsPage, capture.id).click();
    const dialog = clipsPage.getByTestId('bookmark-preview-dialog');
    await dialog.waitFor({ state: 'visible', timeout: 10_000 });
    const ui = await readPanel(clipsPage, 'clip-ocr');
    await snap(clipsPage, 'clip-dialog-scanned-light.png');
    await clipsPage.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
    const pollsAfterOpen = polls;
    const partial = {
      filename: scannedFile, page: cachedPage, pageNumberInput: shownPage, capture, captureAtRunMs: captureAt,
      badge: { first: firstBadge.status, final: done.status, waitedMs: done.waitedMs, timedOut: done.timedOut ?? false, timeline },
      listPollsRunMs: pollsAfterOpen, listPollIntervalsMs: intervals(pollsAfterOpen),
      server: { status: server?.ocr?.status, source: server?.ocr?.source, chars: server?.ocr?.text?.length ?? null, error: server?.ocr?.error, updatedAt: server?.ocr?.updatedAt, textHead: server?.ocr?.text?.slice(0, 200) ?? null },
      dialog: { ...ui, text: undefined, textChars: ui.text?.length ?? null, textEqualsServer: ui.text === (server?.ocr?.text ?? null) },
    };
    try {
      assert.equal(capture.status, 201);
      assert.equal(capture.ocr?.status, 'pending');
      assert.equal(firstBadge.status, 'pending', '마이클립을 열었을 때 배지 pending');
      assert.equal(done.status, 'done', `배지 done (최종 ${done.status}, 서버 ${server?.ocr?.status} ${server?.ocr?.error ?? ''})`);
      assert.equal(server?.ocr?.source, 'vision');
      assert.equal(ui.source, 'vision');
      assert.equal(ui.sourceLabel, TEXT.sourceVision);
      assert.equal(ui.text, server?.ocr?.text, '대화상자 글 = 서버');
    } catch (error) { throw failWith(error.message, partial); }
    return partial;
  });

  if (results.verdict !== 'FAIL') results.verdict = 'PASS';
} catch (error) {
  results.verdict = 'FAIL';
  results.failure = String(error?.stack ?? error).slice(0, 2000);
  process.exitCode = 1;
} finally {
  for (const context of extra) await context.close().catch(() => undefined);
  if (main) await main.close().catch(() => undefined);
  results.pageErrors = pageErrors;
  results.consoleErrors = consoleErrors.slice(0, 50);
  results.blockedWrites = blockedWrites;
  results.allowedWrites = allowedWrites;
  // ── 정리: 이번 실행이 만든 클립을 지우고 시작 목록과 비교한다 ──
  const cleanup = { deleted: [], errors: [] };
  try {
    const baselineIds = new Set(results.baseline.ids);
    const now = await listBookmarks();
    // 응답에서 잡은 id + 혹시 놓친 새 클립(시작 목록에 없고 이번 대상 파일의 것).
    const targets = new Set([...created].filter((id) => !baselineIds.has(id)));
    for (const item of now) if (!baselineIds.has(item.id) && [digitalFile, scannedFile].includes(item.filename) && item.folder === folder) targets.add(item.id);
    for (const id of targets) {
      const response = await fetch(`${origin}/api/bookmarks/${encodeURIComponent(id)}`, { method: 'DELETE' });
      cleanup.deleted.push({ id, status: response.status });
    }
    const final = await listBookmarks();
    cleanup.startCount = results.baseline.bookmarks;
    cleanup.finalCount = final.length;
    cleanup.matchesBaseline = JSON.stringify(final.map((item) => item.id).sort()) === JSON.stringify(results.baseline.ids);
    if (!cleanup.matchesBaseline) { cleanup.errors.push(`최종 클립 목록이 시작과 다르다: ${final.length}`); results.verdict = 'FAIL'; process.exitCode = 1; }
  } catch (error) {
    cleanup.errors.push(String(error?.message ?? error));
    results.verdict = 'FAIL';
    process.exitCode = 1;
  }
  results.cleanup = cleanup;
  results.durationMs = elapsed();
  await browser.close();
  await writeFile(new URL('result.json', output), `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify({ verdict: results.verdict, failure: results.failure, steps: Object.fromEntries(Object.entries(results.steps).map(([name, value]) => [name, value.verdict + (value.error ? ` ${value.error.split('\n')[0]}` : '')])), cleanup, pageErrors, blockedWrites: blockedWrites.length }, null, 2));
}
