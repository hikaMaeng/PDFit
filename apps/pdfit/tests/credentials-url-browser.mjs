import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// 주소에 기본 인증 계정이 들어 있어도(`https://user:pass@host/`) 사이드바가 폴더·태그를 불러오는지 검증한다.
// 배포된 서버 앞에 이 테스트가 직접 띄운 기본 인증 리버스 프록시(임의 계정)를 세워 운영 도메인과 같은 조건을 만든다.
//  A. `user:pass@` 주소로 열기: 사이드바 폴더 행·태그 합계가 API 응답과 같아야 하고, `fetch` 계정 오류가 없어야 한다.
//  B. 대조군: 계정 없는 주소 + 브라우저 자격 증명 옵션으로 열기(프록시 자체는 원인이 아님을 보인다).
//  C. 같은 `user:pass@` 주소로 `/viewer/...`도 `fetch`가 동작하는지.
const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const runId = process.env.PDFIT_TEST_RUN ?? '20261111_credentials-url';
const output = new URL(`./reports/credentials-url/${runId}/`, import.meta.url);
await mkdir(output, { recursive: true });
const shot = (name) => decodeURIComponent(new URL(name, output).pathname.slice(1));

const user = 'pdfit-test-user';
const password = 'p@ss#word!1';
const expectedAuth = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
const upstream = new URL(origin);

// 기본 인증 프록시: Authorization이 맞으면 업스트림으로 그대로 전달(SSE·Range 포함), 아니면 401.
const seen = [];
const proxy = http.createServer((req, res) => {
  const authed = req.headers.authorization === expectedAuth;
  seen.push({ path: (req.url ?? '').split('?')[0], authed });
  if (!authed) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Authorization required"', 'Content-Length': '0' });
    res.end();
    return;
  }
  const headers = { ...req.headers, host: upstream.host };
  delete headers.authorization;
  const forward = http.request({ host: upstream.hostname, port: upstream.port, method: req.method, path: req.url, headers }, (response) => {
    res.writeHead(response.statusCode ?? 502, response.headers);
    response.pipe(res);
  });
  forward.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  res.on('close', () => forward.destroy());
  req.pipe(forward);
});
await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
const proxyPort = proxy.address().port;
const proxyOrigin = `http://127.0.0.1:${proxyPort}`;
const withCredentials = `http://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${proxyPort}`;

const browser = await chromium.launch({ headless: true, ...(process.env.PDFIT_TEST_CHANNEL ? { channel: process.env.PDFIT_TEST_CHANNEL } : {}) });
const results = { origin, proxyPort, channel: process.env.PDFIT_TEST_CHANNEL ?? 'playwright-bundled', browserVersion: browser.version() };
const digits = (text) => Number((text ?? '').replace(/[^0-9]/g, ''));
const apiFolders = await (await fetch(`${origin}/api/folders`)).json();
const apiTags = await (await fetch(`${origin}/api/tags/summary`)).json();
const apiLinkTotal = apiTags.reduce((sum, tag) => sum + tag.bookCount, 0);
results.expected = { folders: apiFolders.length, tags: apiTags.length, tagBookLinks: apiLinkTotal };
assert.ok(apiFolders.length > 0 && apiTags.length > 0, '실제 라이브러리에 폴더와 태그가 있어야 이 테스트가 의미가 있다');

async function checkSidebar(page, label) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  return { errors, label };
}

try {
  // ── A. 계정이 든 주소 ───────────────────────────────────────
  {
    const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const { errors } = await checkSidebar(page, 'A');
    seen.length = 0;
    await page.goto(`${withCredentials}/`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('lnb-tags-section').waitFor({ state: 'visible', timeout: 30000 });
    const loaded = await page.waitForFunction(({ folders, links }) => {
      const total = Number((document.querySelector('[data-testid="tag-assignment-total"]')?.textContent ?? '').replace(/[^0-9]/g, ''));
      return document.querySelectorAll('[data-testid="lnb-folder-row"]').length >= folders && total === links;
    }, { folders: apiFolders.length, links: apiLinkTotal }, { timeout: 20000 }).then(() => true, () => false);
    const state = await page.evaluate(() => ({
      baseURI: document.baseURI,
      href: location.href,
      folderRows: document.querySelectorAll('[data-testid="lnb-folder-row"]').length,
      tagTotal: document.querySelector('[data-testid="tag-assignment-total"]')?.textContent ?? null,
      tagRows: document.querySelectorAll('.pdfit-tag-row').length,
      baseElements: [...document.querySelectorAll('base')].map((element) => element.href),
    }));
    const probe = await page.evaluate(() => fetch('/api/folders').then((response) => `status ${response.status}`, (error) => `${error.name}: ${error.message}`));
    await page.screenshot({ path: shot('credentials-url-sidebar.png'), clip: { x: 0, y: 0, width: 360, height: 700 } });
    const apiSeen = seen.filter((entry) => entry.path.startsWith('/api/folders') || entry.path === '/api/tags/summary');
    results.A = { loaded, ...state, probe, errors, proxyAuthedApi: apiSeen.filter((entry) => entry.authed).length, proxyUnauthedApi: apiSeen.filter((entry) => !entry.authed).length };
    const baseUrl = new URL(state.baseURI);
    assert.deepEqual([baseUrl.username, baseUrl.password], ['', ''], 'document.baseURI에 계정이 없어야 한다');
    assert.equal(probe, 'status 200', '페이지 안에서 상대 경로 fetch가 성공해야 한다');
    assert.equal(loaded, true, `사이드바가 폴더 ${apiFolders.length}개, 태그 연결 ${apiLinkTotal}건을 보여야 한다: ${JSON.stringify(state)}`);
    assert.equal(state.tagRows, apiTags.length, '사이드바 태그 행 수가 태그 요약 수와 같아야 한다');
    assert.equal(errors.filter((text) => /credentials/i.test(text)).length, 0, `계정 관련 fetch 오류가 없어야 한다: ${errors.join(' | ')}`);
    assert.ok(results.A.proxyAuthedApi >= 2, '프록시가 인증된 폴더·태그 API 요청을 받아야 한다');
    await context.close();
  }

  // ── B. 대조군: 계정 없는 주소 + 브라우저 자격 증명 ────────────
  {
    const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 1000 }, httpCredentials: { username: user, password } });
    const page = await context.newPage();
    const { errors } = await checkSidebar(page, 'B');
    await page.goto(`${proxyOrigin}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(({ folders, links }) => {
      const total = Number((document.querySelector('[data-testid="tag-assignment-total"]')?.textContent ?? '').replace(/[^0-9]/g, ''));
      return document.querySelectorAll('[data-testid="lnb-folder-row"]').length >= folders && total === links;
    }, { folders: apiFolders.length, links: apiLinkTotal }, { timeout: 20000 });
    results.B = { baseURI: await page.evaluate(() => document.baseURI), errors };
    assert.equal(errors.length, 0, `대조군에 오류가 없어야 한다: ${errors.join(' | ')}`);
    await context.close();
  }

  // ── C. 계정이 든 주소로 뷰어 열기 ───────────────────────────
  {
    const firstFolder = apiFolders.find((folder) => folder.pdfCount > 0);
    const files = await (await fetch(`${origin}/api/folders/${encodeURIComponent(firstFolder.name)}/files`)).json();
    const file = (Array.isArray(files) ? files : files.files)[0];
    const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const { errors } = await checkSidebar(page, 'C');
    await page.goto(`${withCredentials}/viewer/${encodeURIComponent(firstFolder.name)}/${encodeURIComponent(file.name)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    const probe = await page.evaluate(() => ({ baseURI: document.baseURI, fetch: null }));
    probe.fetch = await page.evaluate(() => fetch('/api/folders').then((response) => `status ${response.status}`, (error) => `${error.name}: ${error.message}`));
    results.C = { path: `/viewer/${firstFolder.name}/${file.name}`, ...probe, errors };
    assert.equal(probe.fetch, 'status 200', '뷰어에서도 상대 경로 fetch가 성공해야 한다');
    assert.equal(errors.filter((text) => /credentials/i.test(text)).length, 0, `뷰어에 계정 관련 오류가 없어야 한다: ${errors.join(' | ')}`);
    await context.close();
  }

  results.verdict = 'PASS';
} catch (error) {
  results.verdict = 'FAIL';
  results.failure = String(error?.message ?? error).slice(0, 1500);
  process.exitCode = 1;
} finally {
  await writeFile(new URL('result.json', output), JSON.stringify(results, null, 2));
  await browser.close();
  proxy.close();
  console.log(JSON.stringify(results, null, 2));
}
