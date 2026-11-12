import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// 표지 보기 카드의 "실제 책 표지로 바꾸기"를 배포된 Free 서버에서 검증한다(커밋 a0d2de2).
// 실제 라이브러리에 쓴다: 대상 파일 하나에 표지를 적용했다가 되돌린다. PDF 자체는 건드리지 않는다.
// 기대값은 페이지 코드가 아니라 서버 API에서 따로 가져온다:
//   적용 이미지 = PUT 요청에 실린 imageUrl을 `GET /api/covers/preview?url=`로 받은 바이트
//   적용 전 표지 = 적용 전 카드 <img> 주소(v=)로 받은 바이트, 적용 기록 = `GET /api/covers`
// 정리: finally에서 시작 시점 `/api/covers`에 없던 항목을 모두 DELETE하고 시작 시점과 같은지 확인한다.
const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const folder = process.env.PDFIT_TEST_FOLDER ?? '이북';
const filename = process.env.PDFIT_TEST_FILE ?? 'Three.js로 3D 그래픽만들기.pdf';
const altQuery = process.env.PDFIT_TEST_ALT_QUERY ?? 'Three.js 3D';
const channel = process.env.PDFIT_TEST_CHANNEL ?? 'chrome';
const runId = process.env.PDFIT_TEST_RUN ?? '20261112_real-cover';
// 앱 언어: packages/pdfit/src/front/model/languagePreference.ts는 localStorage `pdfit.language`를 먼저,
// 없으면 navigator.languages[0]을 쓴다. 둘 다 맞춘다(ko → ko-KR, en → en-US).
const language = process.env.PDFIT_TEST_LANG === 'en' ? 'en' : 'ko';
const locale = language === 'en' ? 'en-US' : 'ko-KR';
// 기본은 실제 번역 POST(`/api/settings/translations`)를 그대로 보낸다. `PDFIT_TEST_STUB_TRANSLATIONS=1`이면
// 그 요청만 가로채 원문을 돌려준다(번역 서버와 무관하게 표지 기능만 볼 때).
const stubTranslations = process.env.PDFIT_TEST_STUB_TRANSLATIONS === '1';
// 끝에 아직 응답이 없는 번역 POST를 최대 이만큼 기다려 소요 시간을 기록한다(0 = 기다리지 않음).
const translationWaitMs = Number(process.env.PDFIT_TEST_TRANSLATION_WAIT_MS ?? 0);
// apps/pdfit/src/front/api/settings.ts의 BATCH_SIZE와 같은 값. 요구 상한 ceil(표시 태그 수 / 50) + 2 계산에만 쓴다.
const BATCH_SIZE = 50;
const output = new URL(`./reports/real-cover/${runId}/`, import.meta.url);
await mkdir(output, { recursive: true });
const shot = (name) => decodeURIComponent(new URL(name, output).pathname.slice(1));

// 화면 문구: packages/pdfit/src/front/i18n/messages.ts의 en(0번)·ko(1번) 값.
const TEXT = {
  ko: { coverView: '표지 보기', realCover: '실제 책 표지로 바꾸기', search: '표지 검색', empty: '표지를 찾지 못했습니다. 제목을 바꿔 다시 검색하세요.', apply: (title, source) => `이 표지 사용: ${title} (${source})`, restore: '첫 페이지 표지로 되돌리기' },
  en: { coverView: 'Cover view', realCover: 'Use a real book cover', search: 'Search covers', empty: 'No covers found. Try a different title.', apply: (title, source) => `Use cover: ${title} (${source})`, restore: 'Restore first page' },
}[language];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const magic = (bytes) => {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
};
const getBytes = async (path) => {
  const response = await fetch(new URL(path, origin));
  return { status: response.status, type: response.headers.get('content-type'), cacheControl: response.headers.get('cache-control'), bytes: Buffer.from(await response.arrayBuffer()) };
};
const describe = (result) => ({ status: result.status, type: result.type, cacheControl: result.cacheControl, length: result.bytes.length, magic: magic(result.bytes), sha256: sha256(result.bytes) });
const listOverrides = async () => {
  const response = await fetch(`${origin}/api/covers`, { cache: 'no-store' });
  assert.equal(response.status, 200, `GET /api/covers → ${response.status}`);
  return (await response.json()).overrides;
};
const entryKey = (item) => `${item.folder}\u0000${item.filename}`;
const findEntry = (overrides) => overrides.find((item) => item.folder === folder && item.filename === filename) ?? null;
const query = filename.replace(/\.pdf$/i, '');

const results = { origin, folder, filename, channel, language, locale, stubTranslations, translationWaitMs, steps: {} };
const step = (name, value) => { results.steps[name] = { verdict: 'PASS', ...value }; };

// ── 전제: 대상 파일이 있고, 아직 바꾼 표지가 없다 ─────────
const baseline = await listOverrides();
results.baseline = { overrides: baseline.length, keys: baseline.map(entryKey) };
const files = await (await fetch(`${origin}/api/folders/${encodeURIComponent(folder)}/files`)).json();
const list = Array.isArray(files) ? files : files.files;
results.folderFiles = list.length;
assert.ok(list.some((file) => file.name === filename), `${folder}/${filename}이 라이브러리에 있어야 한다`);
assert.equal(findEntry(baseline), null, '시작 시점에 대상 파일의 바꾼 표지가 없어야 한다(있으면 사용자의 기존 상태라 건드리지 않는다)');

const browser = await chromium.launch({ headless: true, ...(channel === 'bundled' ? {} : { channel }) });
const startedAt = Date.now();
const elapsed = () => Date.now() - startedAt;
const touched = new Set();
const pageErrors = [];
const writes = [];

// ── 네트워크 기록 ─────────────────────────────────────────
// loads: 페이지 로드(첫 이동·새로고침)마다 하나. 번역 모듈 상태(큐·캐시)는 로드마다 새로 시작하므로 POST 상한은 로드 단위로 본다.
// 키 = 생성 순서, 수명 = 이 실행 전체, 크기 = 로드 수(이 실행은 4개), 지우는 쪽 없음(result.json에 남긴다).
const loads = [];
// translation.posts: 번역 POST마다 하나, 실행 전체 동안 남는다(크기 = POST 수).
const translation = { posts: [], globalInFlight: 0, globalPeak: 0 };
const network = { maxInFlight: 0, failed: {}, thumbnails: { requested: 0, finished: {}, failed: [], finishedWhileTranslationPending: 0 }, covers: { requested: 0, finished: {}, failed: [] } };
// teardown: 이 스크립트가 직접 새로고침하거나 닫는 중인 페이지. 그때의 ERR_ABORTED는 제품 실패와 따로 센다. 작업이 끝나면 지운다.
const teardown = new Set();
// abandoners: 페이지 → 그 페이지의 끝나지 않은 번역 POST를 버려진 것으로 표시하는 함수. 페이지 수(4개)만큼, 실행 동안 남는다.
const abandoners = new Map();
const pathGroup = (url) => new URL(url).pathname.replace(/\/files\/[^/]+/, '/files/*');
const isThumbnail = (url) => /\/files\/[^/]+\/thumbnail$/.test(new URL(url).pathname);
const isCoversList = (request) => request.method() === 'GET' && new URL(request.url()).pathname === '/api/covers';
const isTranslation = (request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/settings/translations';
const hangulOnly = (text) => /[가-힣]/.test(text) && !/[A-Za-z]{2,}/.test(text);
const parseBody = (request) => { try { return JSON.parse(request.postData() ?? '{}'); } catch { return {}; } };

const watch = (page, label) => {
  let inFlight = 0;
  let load = null;
  // byRequest: 번역 POST → { load, post }. 키 = Playwright Request, 요청이 끝나거나 실패하거나 버려지면 지운다.
  const byRequest = new Map();
  // 새로고침·닫기로 버려진 번역 POST: Chrome이 끊지만 Playwright가 requestfailed를 주지 않는 경우가 있어
  // 여기서 끝난 것으로 표시한다(그래야 전역 동시 수가 부풀지 않는다). 서버 쪽 처리가 멈췄다는 뜻은 아니다.
  const abandon = (reason) => {
    for (const [request, tracked] of byRequest) {
      if (load && tracked.load !== load && reason === 'navigation') continue;
      byRequest.delete(request);
      tracked.load.inFlight -= 1; translation.globalInFlight -= 1;
      tracked.post.endedAt = elapsed(); tracked.post.durationMs = tracked.post.endedAt - tracked.post.startedAt;
      tracked.post.failure = `abandoned by ${reason} (no response before the page ${reason === 'navigation' ? 'reloaded' : 'closed'})`;
    }
  };
  abandoners.set(page, abandon);
  const newLoad = () => {
    if (load) abandon('navigation');
    load = { label, index: loads.filter((item) => item.label === label).length, startedAt: elapsed(), posts: 0, inFlight: 0, peak: 0, textsRequested: 0, distinctTexts: new Set(), hangulOnlyTexts: 0, shownTagLabels: null };
    loads.push(load);
  };
  // 문서 로드(첫 이동·새로고침)만 새 로드로 센다. pushState 같은 같은 문서 안 이동은 세지 않는다.
  page.on('request', (request) => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) newLoad(); });
  page.on('pageerror', (error) => pageErrors.push(`${label}: ${error.message}`));
  page.on('request', (request) => {
    inFlight += 1; network.maxInFlight = Math.max(network.maxInFlight, inFlight);
    const method = request.method();
    const url = new URL(request.url());
    if (isThumbnail(request.url())) network.thumbnails.requested += 1;
    if (isCoversList(request)) network.covers.requested += 1;
    if (isTranslation(request)) {
      if (!load) newLoad();
      const body = parseBody(request);
      const texts = Array.isArray(body.texts) ? body.texts : [];
      const post = { page: label, load: load.index, startedAt: elapsed(), texts: texts.length, language: body.language ?? null, sample: texts.slice(0, 5), endedAt: null, durationMs: null, status: null, failure: null, inPageInFlightBefore: load.inFlight, globalInFlightBefore: translation.globalInFlight };
      translation.posts.push(post);
      load.posts += 1; load.inFlight += 1; load.peak = Math.max(load.peak, load.inFlight);
      load.textsRequested += texts.length; texts.forEach((text) => load.distinctTexts.add(text)); load.hangulOnlyTexts += texts.filter(hangulOnly).length;
      translation.globalInFlight += 1; translation.globalPeak = Math.max(translation.globalPeak, translation.globalInFlight);
      byRequest.set(request, { load, post });
      return;
    }
    if (method === 'GET' || method === 'HEAD') return;
    if (url.pathname === '/api/folders/refresh') return;
    writes.push(`${label} ${method} ${url.pathname}`);
  });
  const settle = async (request, failure) => {
    inFlight -= 1;
    const tracked = byRequest.get(request);
    if (tracked) {
      byRequest.delete(request);
      tracked.load.inFlight -= 1; translation.globalInFlight -= 1;
      tracked.post.endedAt = elapsed(); tracked.post.durationMs = tracked.post.endedAt - tracked.post.startedAt;
      if (failure) tracked.post.failure = failure; else tracked.post.status = (await request.response().catch(() => null))?.status() ?? null;
      return;
    }
    const bucket = isThumbnail(request.url()) ? network.thumbnails : isCoversList(request) ? network.covers : null;
    if (!bucket) return;
    if (failure) {
      bucket.failed.push({ page: label, at: elapsed(), path: pathGroup(request.url()), error: failure, duringOwnTeardown: teardown.has(page) });
      return;
    }
    const pendingNow = translation.globalInFlight;
    const status = (await request.response().catch(() => null))?.status() ?? 'none';
    bucket.finished[status] = (bucket.finished[status] ?? 0) + 1;
    if (bucket === network.thumbnails && status === 200 && pendingNow > 0) bucket.finishedWhileTranslationPending += 1;
  };
  page.on('requestfinished', (request) => { void settle(request, null); });
  page.on('requestfailed', (request) => {
    const reason = `${request.method()} ${pathGroup(request.url())} ${request.failure()?.errorText ?? ''}`;
    network.failed[reason] = (network.failed[reason] ?? 0) + 1;
    void settle(request, request.failure()?.errorText ?? 'unknown');
  });
};
// 한 로드에서 화면에 나온 태그 칩의 고유 이름 수(칩 요소마다 처음 붙은 title = 번역 전 원문).
const recordShownTags = async (page, label) => {
  const load = [...loads].reverse().find((item) => item.label === label);
  const names = await page.evaluate(() => [...(window.__pdfitShownTags ?? [])]).catch(() => null);
  if (load && names) load.shownTagLabels = names.length;
  return names;
};
const reloadPage = async (page) => { teardown.add(page); try { await page.reload({ waitUntil: 'domcontentloaded' }); } finally { teardown.delete(page); } };
const closeContext = async (context, page) => { teardown.add(page); await context.close(); abandoners.get(page)?.('close'); };

const newContext = async (options, { view = null, mode }) => {
  const context = await browser.newContext({ locale, ...options });
  await context.addInitScript(({ view, mode, language }) => {
    try {
      window.localStorage.setItem('pdfit.color-mode', mode);
      window.localStorage.setItem('pdfit.language', language);
      if (view) window.localStorage.setItem('pdfit.library.view', view);
    } catch { /* ignore */ }
    // 태그 칩(data-testid=pdf-tag-chip)이 처음 붙을 때의 title을 모은다. 로드마다 새로 시작하고 페이지와 함께 사라진다.
    const seen = new WeakSet();
    const shown = new Set();
    window.__pdfitShownTags = shown;
    const collect = (root) => {
      if (!(root instanceof Element)) return;
      const chips = root.matches?.('[data-testid="pdf-tag-chip"]') ? [root] : [...root.querySelectorAll('[data-testid="pdf-tag-chip"]')];
      for (const chip of chips) { if (seen.has(chip)) continue; seen.add(chip); const title = chip.getAttribute('title'); if (title) shown.add(title); }
    };
    new MutationObserver((records) => { for (const record of records) record.addedNodes.forEach(collect); }).observe(document, { childList: true, subtree: true });
  }, { view, mode, language });
  if (stubTranslations) {
    await context.route('**/api/settings/translations', (route) => {
      const texts = parseBody(route.request()).texts ?? [];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ translations: texts }) });
    });
  }
  return context;
};
const cardOf = (page) => page.getByTestId('pdf-cover-card').filter({ has: page.locator(`a[title="${filename.replace(/"/g, '\\"')}"]`) }).first();
const thumbOf = (card) => card.locator('[data-testid="pdf-cover-thumbnail"][data-cover-source="server"]');
// 카드 이미지가 실제로 로드될 때까지 기다린 뒤 주소와 크기를 돌려준다.
const readyImage = async (card, predicate, label) => {
  const thumb = thumbOf(card);
  await card.scrollIntoViewIfNeeded();
  const deadline = Date.now() + 30000;
  let last = null;
  while (Date.now() < deadline) {
    last = await thumb.evaluate((node) => {
      const img = node.querySelector('img');
      return { state: node.getAttribute('data-cover-state'), src: img?.getAttribute('src') ?? null, complete: img?.complete ?? false, naturalWidth: img?.naturalWidth ?? 0, naturalHeight: img?.naturalHeight ?? 0 };
    });
    if (last.state === 'ready' && last.complete && last.naturalWidth > 0 && last.src && predicate(last.src)) return last;
    await card.page().waitForTimeout(250);
  }
  throw new Error(`${label}: 카드 이미지가 조건을 만족하며 로드되지 않았다 ${JSON.stringify(last)}`);
};
// 화면 안 서버 썸네일이 모두 끝날(로드 또는 실패) 때까지 최대 30초 기다리고 상태별 수를 센다.
// 그 순간 끝나지 않은 번역 POST 수도 함께 남긴다(번역이 걸려 있는 동안 썸네일이 로드되는지 보는 근거).
const thumbnailCensus = async (page, label) => {
  const deadline = Date.now() + 30000;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('[data-testid="pdf-cover-thumbnail"][data-cover-source="server"]')].filter((node) => { const rect = node.getBoundingClientRect(); return rect.bottom > 0 && rect.top < window.innerHeight; });
      const states = {};
      for (const node of nodes) {
        const img = node.querySelector('img');
        const state = node.getAttribute('data-cover-state');
        const key = state === 'ready' && img?.complete && img.naturalWidth > 0 ? 'loaded' : state ?? 'none';
        states[key] = (states[key] ?? 0) + 1;
      }
      const all = [...document.querySelectorAll('[data-testid="pdf-cover-card"]')];
      const firstCard = all.findIndex((card) => card.getBoundingClientRect().bottom > 0);
      return { inView: nodes.length, states, firstVisibleCardIndex: firstCard, totalCards: all.length };
    });
    if (last.inView > 0 && (last.states.loaded ?? 0) + (last.states.failed ?? 0) === last.inView) break;
    await page.waitForTimeout(500);
  }
  return { label, at: elapsed(), translationPostsPendingGlobal: translation.globalInFlight, translationPostsSoFar: translation.posts.length, ...last };
};
const openDialog = async (page, card) => {
  const candidatesResponse = page.waitForResponse((response) => response.url().includes('/api/covers/candidates?'), { timeout: 30000 });
  const button = card.getByTestId('pdf-cover-real-cover');
  await button.scrollIntoViewIfNeeded();
  await button.click();
  const dialog = page.getByTestId('real-cover-dialog');
  await dialog.waitFor({ state: 'visible', timeout: 10000 });
  const response = await candidatesResponse;
  const payload = await response.json();
  return { dialog, request: new URL(response.url()).searchParams.get('q'), status: response.status(), payload };
};
const waitCandidates = async (page, count) => {
  await page.waitForFunction((expected) => document.querySelectorAll('ul[data-testid="real-cover-candidates"] > li[data-testid="real-cover-candidate"]').length === expected, count, { timeout: 15000 });
};
// 검색 버튼 글자가 한 줄인지. 버튼 안 글자 노드(text node)만 Range로 재서
//   textLines = 글자 줄 상자의 서로 다른 top 수(1이어야 한다),
//   textHeight = 글자 상자 높이 ≤ 계산된 line-height + 1px(한 줄 높이),
//   height(버튼 상자) < twoLineHeight(두 줄일 때 높이 = padding + border + line-height × 2).
// 버튼 상자 높이는 flex 행에서 옆 TextField 높이로 늘어나므로(align-items: stretch) 한 줄 높이와 같을 필요는 없다.
const searchButtonGeometry = (page) => page.getByTestId('real-cover-search').evaluate((node) => {
  const style = getComputedStyle(node);
  const px = (value) => Number.parseFloat(value) || 0;
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const rects = [];
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (!text.textContent.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(text);
    rects.push(...[...range.getClientRects()].filter((rect) => rect.width > 0));
  }
  const lineTops = new Set(rects.map((rect) => Math.round(rect.top)));
  const textTop = Math.min(...rects.map((rect) => rect.top));
  const textBottom = Math.max(...rects.map((rect) => rect.bottom));
  const rect = node.getBoundingClientRect();
  const field = node.closest('form')?.querySelector('.MuiInputBase-root')?.getBoundingClientRect();
  const lineHeight = style.lineHeight === 'normal' ? px(style.fontSize) * 1.2 : px(style.lineHeight);
  const chrome = px(style.paddingTop) + px(style.paddingBottom) + px(style.borderTopWidth) + px(style.borderBottomWidth);
  const round = (value) => Math.round(value * 10) / 10;
  return { text: node.innerText.trim(), width: round(rect.width), height: round(rect.height), siblingFieldHeight: field ? round(field.height) : null, lineHeight, textHeight: round(textBottom - textTop), textLines: lineTops.size, singleLineHeight: round(lineHeight + chrome), twoLineHeight: round(lineHeight * 2 + chrome), whiteSpace: style.whiteSpace, flexShrink: style.flexShrink, viewport: window.innerWidth };
});

let context = null;
let page = null;
try {
  // ── 1. 표지 보기로 전환하고 대상 카드를 찾는다 ───────────
  context = await newContext({ viewport: { width: 1440, height: 1000 } }, { mode: 'light' });
  page = await context.newPage();
  watch(page, 'main');
  await page.goto(`${origin}/folder/${encodeURIComponent(folder)}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: TEXT.coverView, exact: true }).click();
  await page.getByTestId('pdf-cover-card').first().waitFor({ timeout: 30000 });
  // 1a. 썸네일 조사: 맨 위와 아래로 세 화면.
  const census = [];
  census.push(await thumbnailCensus(page, 'top'));
  await page.mouse.move(900, 600);
  for (let screen = 1; screen <= 3; screen += 1) {
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(300);
    census.push(await thumbnailCensus(page, `screen-${screen}`));
  }
  await page.getByTestId('pdf-cover-card').first().scrollIntoViewIfNeeded();
  results.thumbnailCensus = census;
  const card = cardOf(page);
  await card.waitFor({ timeout: 30000 });
  const before = await readyImage(card, (src) => !/[?&]c=/.test(src), '적용 전');
  const beforeBytes = await getBytes(before.src);
  assert.equal(beforeBytes.status, 200);
  assert.ok(magic(beforeBytes.bytes), '적용 전 표지는 이미지여야 한다');
  const button = card.getByTestId('pdf-cover-real-cover');
  assert.equal(await button.getAttribute('aria-label'), TEXT.realCover, '버튼 접근 이름');
  assert.equal(await page.evaluate(() => window.localStorage.getItem('pdfit.library.view')), 'covers', '표지 보기 선택이 저장된다');
  assert.equal(await page.evaluate(() => document.documentElement.lang), language, '앱 언어(html lang)');
  for (const item of census) assert.equal(item.states.failed ?? 0, 0, `썸네일 조사 ${item.label}: 실패한 카드 없음 ${JSON.stringify(item)}`);
  for (const item of census) assert.equal(item.states.loaded, item.inView, `썸네일 조사 ${item.label}: 화면 안 카드 모두 로드 ${JSON.stringify(item)}`);
  step('1_cover_view_card', { src: before.src, naturalWidth: before.naturalWidth, naturalHeight: before.naturalHeight, bytes: describe(beforeBytes) });

  // ── 2. 대화상자 열기: 파일 이름 검색어, 자동 검색, 포커스 ──
  const first = await openDialog(page, card);
  const dialog = first.dialog;
  // MUI는 data-testid를 루트(모달)에, aria-labelledby를 안쪽 role="dialog" 요소에 붙인다.
  const dialogRole = page.getByRole('dialog', { name: TEXT.realCover });
  assert.equal(await dialogRole.count(), 1, '접근 이름이 제목인 dialog가 하나 있어야 한다');
  assert.equal(await dialogRole.getAttribute('aria-labelledby'), 'real-cover-dialog-title');
  assert.equal(await dialog.locator('[role="dialog"]').count(), 1, 'role=dialog는 real-cover-dialog 안에 있다');
  assert.equal((await page.locator('#real-cover-dialog-title').innerText()).trim(), TEXT.realCover);
  assert.equal(await page.getByTestId('real-cover-query').inputValue(), query, '검색어 = 파일 이름에서 .pdf를 뺀 값');
  assert.equal(first.request, query, '자동 검색 요청의 q = 미리 채운 검색어');
  assert.equal(first.status, 200);
  assert.ok(first.payload.candidates.length > 0, `자동 검색 후보가 있어야 한다: ${JSON.stringify(first.payload)}`);
  await waitCandidates(page, first.payload.candidates.length);
  const focusInside = await dialog.evaluate((node) => node.contains(document.activeElement) && document.activeElement !== document.body);
  assert.ok(focusInside, '대화상자를 열면 키보드 포커스가 대화상자 안에 있어야 한다');
  await page.keyboard.press('Tab');
  const focusAfterTab = await dialog.evaluate((node) => node.contains(document.activeElement));
  assert.ok(focusAfterTab, 'Tab을 눌러도 포커스가 대화상자 안에 머문다');
  const labels = await page.locator('li[data-testid="real-cover-candidate"] > button').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
  assert.deepEqual(labels, first.payload.candidates.map((item) => TEXT.apply(item.title, item.source)), '후보 버튼 이름 = API 후보 순서와 제목·출처');
  assert.equal(await page.getByTestId('real-cover-restore').count(), 0, '바꾼 표지가 없으면 되돌리기 버튼이 없다');
  // 2a. 1440px에서 검색 버튼 글자가 한 줄이다.
  const searchButton = await searchButtonGeometry(page);
  await page.screenshot({ path: shot('dialog-candidates-light.png') });
  await page.getByTestId('real-cover-search').screenshot({ path: shot('search-button-1440.png') });
  assert.equal(searchButton.text, TEXT.search, '검색 버튼 글자');
  assert.equal(searchButton.textLines, 1, `검색 버튼 글자가 한 줄 ${JSON.stringify(searchButton)}`);
  assert.ok(searchButton.textHeight <= searchButton.lineHeight + 1, `검색 버튼 글자 높이 ≤ 한 줄 line-height + 1px ${JSON.stringify(searchButton)}`);
  assert.ok(searchButton.height < searchButton.twoLineHeight, `검색 버튼 높이 < 두 줄 높이 ${JSON.stringify(searchButton)}`);
  step('2_dialog_auto_search', { query: first.request, candidates: first.payload.candidates.length, failedSources: first.payload.failedSources, firstCandidate: first.payload.candidates[0], focusInside, focusAfterTab, searchButton });

  // ── 3. 검색어를 바꾸고 검색 버튼 → 다시 검색 ─────────────
  {
    await page.getByTestId('real-cover-query').fill(altQuery);
    const response = page.waitForResponse((item) => item.url().includes('/api/covers/candidates?') && new URL(item.url()).searchParams.get('q') === altQuery, { timeout: 30000 });
    await page.getByTestId('real-cover-search').click();
    const altResponse = await response;
    const altPayload = await altResponse.json();
    assert.equal(altResponse.status(), 200);
    if (altPayload.candidates.length > 0) await waitCandidates(page, altPayload.candidates.length);
    else await page.getByText(TEXT.empty).waitFor({ timeout: 15000 });
    const shown = await page.locator('li[data-testid="real-cover-candidate"]').count();
    step('3_edited_query_research', { query: altQuery, candidates: altPayload.candidates.length, shown });
    // 원래 검색어로 되돌려 다시 검색한다(적용할 후보는 원래 검색의 첫 후보).
    await page.getByTestId('real-cover-query').fill(query);
    const back = page.waitForResponse((item) => item.url().includes('/api/covers/candidates?') && new URL(item.url()).searchParams.get('q') === query, { timeout: 30000 });
    await page.getByTestId('real-cover-search').click();
    const backPayload = await (await back).json();
    assert.ok(backPayload.candidates.length > 0);
    await waitCandidates(page, backPayload.candidates.length);
    first.payload = backPayload;
  }

  // ── 4. 첫 후보 적용 → 대화상자 닫힘, 카드 c=, 바이트 = preview ──
  const chosen = first.payload.candidates[0];
  const putRequest = page.waitForRequest((request) => request.method() === 'PUT' && new URL(request.url()).pathname === '/api/covers', { timeout: 15000 });
  const putResponse = page.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === '/api/covers', { timeout: 60000 });
  touched.add(entryKey({ folder, filename }));
  await page.locator('li[data-testid="real-cover-candidate"] > button').first().click();
  const putBody = JSON.parse((await putRequest).postData() ?? '{}');
  const put = await putResponse;
  const putPayload = await put.json();
  assert.equal(put.status(), 200, `PUT /api/covers → ${put.status()} ${JSON.stringify(putPayload)}`);
  assert.deepEqual({ folder: putBody.folder, filename: putBody.filename, imageUrl: putBody.imageUrl, source: putBody.source, title: putBody.title }, { folder, filename, imageUrl: chosen.imageUrl, source: chosen.source, title: chosen.title }, 'PUT 본문 = 첫 후보');
  await dialog.waitFor({ state: 'hidden', timeout: 15000 });
  const after = await readyImage(card, (src) => new URL(src, origin).searchParams.get('c') === putPayload.version, '적용 후');
  const afterBytes = await getBytes(after.src);
  const previewBytes = await getBytes(`/api/covers/preview?url=${encodeURIComponent(chosen.imageUrl)}`);
  assert.equal(afterBytes.status, 200);
  assert.equal(previewBytes.status, 200);
  assert.ok(magic(afterBytes.bytes), '적용 후 카드 이미지는 JPEG/PNG/WebP여야 한다');
  assert.equal(sha256(afterBytes.bytes), sha256(previewBytes.bytes), '카드 이미지 바이트 = preview로 받은 후보 이미지 바이트');
  assert.notEqual(sha256(afterBytes.bytes), sha256(beforeBytes.bytes), '카드 이미지 바이트 ≠ 적용 전(첫 페이지 렌더) 바이트');
  const listed = findEntry(await listOverrides());
  assert.ok(listed, '/api/covers가 대상 파일을 나열한다');
  assert.equal(listed.version, putPayload.version);
  assert.equal(listed.source, chosen.source);
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: shot('card-replaced-light.png') });
  await page.screenshot({ path: shot('page-replaced-light.png') });
  step('4_apply_first_candidate', { chosen: { source: chosen.source, title: chosen.title, imageUrl: chosen.imageUrl }, version: putPayload.version, src: after.src, naturalWidth: after.naturalWidth, naturalHeight: after.naturalHeight, cardBytes: describe(afterBytes), previewBytes: describe(previewBytes), listed });

  // ── 5. 새로고침 뒤에도 바꾼 표지가 유지된다 ──────────────
  await recordShownTags(page, 'main');
  await reloadPage(page);
  await page.getByTestId('pdf-cover-card').first().waitFor({ timeout: 30000 });
  const reloadedCard = cardOf(page);
  await reloadedCard.waitFor({ timeout: 30000 });
  const reloaded = await readyImage(reloadedCard, (src) => new URL(src, origin).searchParams.get('c') === putPayload.version, '새로고침 후');
  const reloadedBytes = await getBytes(reloaded.src);
  assert.equal(sha256(reloadedBytes.bytes), sha256(previewBytes.bytes));
  step('5_reload_persists', { src: reloaded.src, sha256: sha256(reloadedBytes.bytes), view: await page.evaluate(() => window.localStorage.getItem('pdfit.library.view')) });

  // ── 6. 다크 테마: 바꾼 카드와 대화상자(되돌리기 버튼 보임) ──
  {
    const dark = await newContext({ viewport: { width: 1440, height: 1000 } }, { view: 'covers', mode: 'dark' });
    const darkPage = await dark.newPage();
    watch(darkPage, 'dark');
    try {
      await darkPage.goto(`${origin}/folder/${encodeURIComponent(folder)}`, { waitUntil: 'domcontentloaded' });
      const darkCard = cardOf(darkPage);
      await darkCard.waitFor({ timeout: 30000 });
      const darkImage = await readyImage(darkCard, (src) => new URL(src, origin).searchParams.get('c') === putPayload.version, '다크 테마');
      await darkCard.screenshot({ path: shot('card-replaced-dark.png') });
      const opened = await openDialog(darkPage, darkCard);
      if (opened.payload.candidates.length > 0) await waitCandidates(darkPage, opened.payload.candidates.length);
      await darkPage.getByTestId('real-cover-restore').waitFor({ state: 'visible', timeout: 5000 });
      const background = await darkPage.locator('[data-testid="real-cover-dialog"] .MuiDialog-paper').evaluate((node) => getComputedStyle(node).backgroundColor);
      const darkSearchButton = await searchButtonGeometry(darkPage);
      await darkPage.screenshot({ path: shot('dialog-candidates-dark.png') });
      assert.equal(darkSearchButton.textLines, 1, `다크 검색 버튼 글자 한 줄 ${JSON.stringify(darkSearchButton)}`);
      await darkPage.keyboard.press('Escape');
      await opened.dialog.waitFor({ state: 'hidden', timeout: 10000 });
      await recordShownTags(darkPage, 'dark');
      step('6_dark_theme', { src: darkImage.src, dialogPaperBackground: background, restoreVisible: true, escapeCloses: true, searchButton: darkSearchButton });
    } finally { await closeContext(dark, darkPage); }
  }

  // ── 7. 375px 모바일 화면의 대화상자 ─────────────────────
  {
    const mobile = await newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true }, { view: 'covers', mode: 'light' });
    const mobilePage = await mobile.newPage();
    watch(mobilePage, 'mobile');
    try {
      await mobilePage.goto(`${origin}/folder/${encodeURIComponent(folder)}`, { waitUntil: 'domcontentloaded' });
      const mobileCard = cardOf(mobilePage);
      await mobileCard.waitFor({ timeout: 30000 });
      const opened = await openDialog(mobilePage, mobileCard);
      if (opened.payload.candidates.length > 0) await waitCandidates(mobilePage, opened.payload.candidates.length);
      const geometry = await mobilePage.evaluate(() => {
        const paper = document.querySelector('[data-testid="real-cover-dialog"] .MuiDialog-paper').getBoundingClientRect();
        const list = document.querySelector('[data-testid="real-cover-candidates"]');
        return { viewport: window.innerWidth, paperLeft: Math.round(paper.left), paperRight: Math.round(paper.right), pageOverflow: document.documentElement.scrollWidth - window.innerWidth, listOverflow: list ? list.scrollWidth - list.clientWidth : null };
      });
      assert.ok(geometry.paperLeft >= 0 && geometry.paperRight <= geometry.viewport, `대화상자가 화면 안에 있어야 한다 ${JSON.stringify(geometry)}`);
      assert.ok(geometry.pageOverflow <= 0, `페이지 가로 넘침 없음 ${geometry.pageOverflow}`);
      assert.ok(geometry.listOverflow === null || geometry.listOverflow <= 0, `후보 목록 가로 넘침 없음 ${geometry.listOverflow}`);
      await mobilePage.screenshot({ path: shot('dialog-mobile-375.png') });
      await mobilePage.keyboard.press('Escape');
      await opened.dialog.waitFor({ state: 'hidden', timeout: 10000 });
      await recordShownTags(mobilePage, 'mobile');
      step('7_mobile_375', geometry);
    } finally { await closeContext(mobile, mobilePage); }
  }

  // ── 8. 되돌리기 → c= 없음, 바이트 = 적용 전, /api/covers에서 빠짐 ──
  {
    const opened = await openDialog(page, reloadedCard);
    if (opened.payload.candidates.length > 0) await waitCandidates(page, opened.payload.candidates.length);
    const restore = page.getByTestId('real-cover-restore');
    await restore.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal((await restore.innerText()).trim(), TEXT.restore);
    const deleteResponse = page.waitForResponse((response) => response.request().method() === 'DELETE' && new URL(response.url()).pathname === '/api/covers', { timeout: 15000 });
    await restore.click();
    const deleted = await deleteResponse;
    const deletedPayload = await deleted.json();
    assert.equal(deleted.status(), 200);
    assert.equal(deletedPayload.removed, true);
    await opened.dialog.waitFor({ state: 'hidden', timeout: 15000 });
    const restored = await readyImage(reloadedCard, (src) => !/[?&]c=/.test(src), '되돌린 후');
    const restoredBytes = await getBytes(restored.src);
    assert.equal(restored.src, before.src, '되돌린 뒤 카드 주소 = 적용 전 주소');
    assert.equal(sha256(restoredBytes.bytes), sha256(beforeBytes.bytes), '되돌린 뒤 바이트 = 적용 전(첫 페이지 렌더) 바이트');
    assert.equal(findEntry(await listOverrides()), null, '/api/covers에서 대상 파일이 빠진다');
    await reloadedCard.screenshot({ path: shot('card-restored-light.png') });
    step('8_restore', { src: restored.src, removed: deletedPayload.removed, bytes: describe(restoredBytes) });
  }

  // 끝에 남은 번역 POST를 기다린다(선택). 기다리기 전에 페이지 가운데에서 썸네일 조사를 한 번 더 한다.
  await recordShownTags(page, 'main');
  if (translationWaitMs > 0 && translation.globalInFlight > 0) {
    const cards = page.getByTestId('pdf-cover-card');
    await cards.nth(Math.floor((await cards.count()) / 2)).scrollIntoViewIfNeeded();
    results.thumbnailCensusWhileWaiting = await thumbnailCensus(page, 'middle-while-waiting');
    const deadline = Date.now() + translationWaitMs;
    while (translation.globalInFlight > 0 && Date.now() < deadline) await page.waitForTimeout(1000);
  }
  results.translationPendingAtClose = translation.globalInFlight;
  const closing = context;
  context = null;
  await closeContext(closing, page);
  const unexpectedWrites = writes.filter((entry) => !/ (PUT|DELETE) \/api\/covers$/.test(entry));
  assert.deepEqual(pageErrors, [], 'pageerror 없음');
  assert.deepEqual(unexpectedWrites, [], `/api/covers PUT·DELETE 말고 쓰기 요청이 없어야 한다: ${unexpectedWrites.join(', ')}`);
  results.verdict = 'PASS';
} catch (error) {
  results.verdict = 'FAIL';
  results.failure = String(error?.stack ?? error).slice(0, 2000);
  process.exitCode = 1;
  if (page && context) await recordShownTags(page, 'main');
} finally {
  if (context) await closeContext(context, page).catch(() => undefined);
  // ── 네트워크 단언: 기능 단계가 실패해도 기록한다 ──────────
  const assertions = {};
  const check = (name, pass, detail) => { assertions[name] = { pass, ...detail }; if (!pass) { results.verdict = 'FAIL'; process.exitCode = 1; } };
  const insufficient = Object.entries(network.failed).filter(([reason]) => reason.includes('ERR_INSUFFICIENT_RESOURCES')).reduce((sum, [, count]) => sum + count, 0);
  check('no_err_insufficient_resources', insufficient === 0, { count: insufficient });
  const unexpectedThumbFailures = network.thumbnails.failed.filter((item) => !item.duringOwnTeardown);
  const thumbHttpErrors = Object.entries(network.thumbnails.finished).filter(([status]) => status !== '200' && status !== '304').reduce((sum, [, count]) => sum + count, 0);
  check('thumbnails_no_failed_requests', unexpectedThumbFailures.length === 0 && thumbHttpErrors === 0, { failedOutsideOwnTeardown: unexpectedThumbFailures.length, abortedDuringOwnTeardown: network.thumbnails.failed.length - unexpectedThumbFailures.length, httpErrors: thumbHttpErrors });
  const unexpectedCoverFailures = network.covers.failed.filter((item) => !item.duringOwnTeardown);
  const coverHttpErrors = Object.entries(network.covers.finished).filter(([status]) => status !== '200').reduce((sum, [, count]) => sum + count, 0);
  check('covers_list_no_failed_requests', unexpectedCoverFailures.length === 0 && coverHttpErrors === 0, { failedOutsideOwnTeardown: unexpectedCoverFailures.length, abortedDuringOwnTeardown: network.covers.failed.length - unexpectedCoverFailures.length, httpErrors: coverHttpErrors });
  const perLoad = loads.map((load) => ({ page: load.label, load: load.index, posts: load.posts, peakConcurrent: load.peak, textsRequested: load.textsRequested, distinctTextsRequested: load.distinctTexts.size, hangulOnlyTextsRequested: load.hangulOnlyTexts, shownTagLabels: load.shownTagLabels, bound: load.shownTagLabels == null ? null : Math.ceil(load.shownTagLabels / BATCH_SIZE) + 2 }));
  const peakPerLoad = Math.max(0, ...perLoad.map((item) => item.peakConcurrent));
  check('translation_peak_concurrency_per_page_load_le_1', peakPerLoad <= 1, { peakPerLoad, peakAcrossPagesGlobal: translation.globalPeak });
  if (language === 'ko') {
    const over = perLoad.filter((item) => item.bound == null ? item.posts > 0 : item.posts > item.bound);
    check('translation_posts_within_bound_ko', !stubTranslations && over.length === 0, { rule: 'posts per page load <= ceil(shownTagLabels / 50) + 2 (stubbed runs do not count)', over });
  }
  results.assertions = assertions;
  results.translation = {
    total: translation.posts.length,
    peakPerLoad,
    peakAcrossPagesGlobal: translation.globalPeak,
    pendingAtEnd: translation.globalInFlight,
    textsRequested: translation.posts.reduce((sum, post) => sum + post.texts, 0),
    hangulOnlyTextsRequested: perLoad.reduce((sum, item) => sum + item.hangulOnlyTextsRequested, 0),
    perLoad,
    posts: translation.posts,
  };
  results.pageErrors = pageErrors;
  results.writes = writes;
  results.network = network;
  // ── 정리: 이번 실행이 만든 항목을 지우고 시작 상태와 비교한다 ──
  const cleanup = { deleted: [], errors: [] };
  try {
    const baselineKeys = new Set(baseline.map(entryKey));
    const now = await listOverrides();
    const created = now.filter((item) => !baselineKeys.has(entryKey(item)) && touched.has(entryKey(item)));
    for (const item of created) {
      const response = await fetch(`${origin}/api/covers?folder=${encodeURIComponent(item.folder)}&filename=${encodeURIComponent(item.filename)}`, { method: 'DELETE' });
      cleanup.deleted.push({ folder: item.folder, filename: item.filename, status: response.status });
    }
    const final = await listOverrides();
    cleanup.finalOverrides = final.length;
    cleanup.finalKeys = final.map(entryKey);
    cleanup.matchesBaseline = JSON.stringify(final.map(entryKey).sort()) === JSON.stringify(baseline.map(entryKey).sort());
    if (!cleanup.matchesBaseline) { cleanup.errors.push(`최종 /api/covers가 시작과 다르다: ${JSON.stringify(final)}`); results.verdict = 'FAIL'; process.exitCode = 1; }
  } catch (error) {
    cleanup.errors.push(String(error?.message ?? error));
    results.verdict = 'FAIL';
    process.exitCode = 1;
  }
  results.cleanup = cleanup;
  results.durationMs = elapsed();
  await browser.close();
  await writeFile(new URL('result.json', output), `${JSON.stringify(results, null, 2)}\n`);
  const { posts, ...translationSummary } = results.translation;
  console.log(JSON.stringify({ verdict: results.verdict, failure: results.failure, assertions, translation: translationSummary, thumbnails: { requested: network.thumbnails.requested, finished: network.thumbnails.finished, failed: network.thumbnails.failed.length, finishedWhileTranslationPending: network.thumbnails.finishedWhileTranslationPending }, census: results.thumbnailCensus, censusWhileWaiting: results.thumbnailCensusWhileWaiting, cleanup, steps: Object.keys(results.steps) }, null, 2));
}
