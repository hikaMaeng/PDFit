import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// 게이트웨이(리버스 프록시)가 502를 돌려준 페이지 텍스트 요청이 스스로 회복되는지 배포된 Free 서버에서 검증한다.
// 외부 기준: nginx-proxy 에러 로그 2026/11/13 01:55:36~53, "connect() failed (111: Connection refused)
// while connecting to upstream ... request: POST /api/ocr/page" — 서버가 내려간 동안 프록시가 502 HTML을 돌려준다.
// 그 응답을 그대로 흉내 내어(Content-Type: text/html, nginx 502 본문) 주입한다.
//   2단계 첫 두 번만 502 -> 패널은 pending을 유지하다 done으로 끝나고 요청은 3회 나간다.
//   3단계 모든 시도 502 -> 최종 실패 문구가 ko "서버에 연결하지 못했습니다…"다(HTTP 502 가 아니라).
// 읽기 위치·뷰어 상태 쓰기는 가로채 서버로 보내지 않는다.
const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const folder = process.env.PDFIT_TEST_FOLDER ?? '이북';
const filename = process.env.PDFIT_TEST_FILE ?? '딥러닝을 위한 수학.pdf';
const pageNumber = Number(process.env.PDFIT_TEST_PAGE ?? 24);
const channel = process.env.PDFIT_TEST_CHANNEL ?? 'chrome';
const runId = process.env.PDFIT_TEST_RUN ?? '20261113_ocr_gateway';
const locale = 'ko-KR';
const output = new URL(`./reports/ocr-gateway-recovery/${runId}/`, import.meta.url);
await mkdir(output, { recursive: true });
const shot = (name) => decodeURIComponent(new URL(name, output).pathname.slice(1));

// 화면 문구: packages/pdfit/src/front/i18n/messages.ts 의 ko(1번) 값.
const TEXT = {
  unreachable: '텍스트를 읽지 못했습니다. 서버에 연결하지 못했습니다. 다시 시작하는 중일 수 있으니 잠시 후 다시 시도하세요.',
  close: '닫기',
};
// nginx 가 업스트림에 붙지 못했을 때 돌려주는 본문.
const GATEWAY_BODY = '<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n<center><h1>502 Bad Gateway</h1></center>\r\n<hr><center>openresty</center>\r\n</body>\r\n</html>\r\n';

const startedAt = Date.now();
const elapsed = () => Date.now() - startedAt;
const results = { origin, folder, filename, pageNumber, channel, locale, startedAtIso: new Date(startedAt).toISOString(), steps: {} };
const runStep = async (name, fn) => {
  const begun = elapsed();
  try {
    results.steps[name] = { verdict: 'PASS', ...(await fn()), stepMs: elapsed() - begun };
  } catch (error) {
    results.steps[name] = { verdict: 'FAIL', ...(error?.partial ?? {}), error: String(error?.stack ?? error).slice(0, 1500), stepMs: elapsed() - begun };
    results.verdict = 'FAIL';
    process.exitCode = 1;
  }
  console.log(`${name}: ${results.steps[name].verdict}`);
  return results.steps[name];
};

const viewerUrl = `${origin}/viewer/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}?page=${pageNumber}`;
const browser = await chromium.launch({ channel, headless: true });
const context = await browser.newContext({ locale, viewport: { width: 1600, height: 1000 } });

// 독서 상태 쓰기는 서버로 보내지 않는다.
await context.route('**/api/progress/**', (route) => route.fulfill({ status: 204, body: '' }));
await context.route('**/api/viewer-state/**', (route) => route.fulfill({ status: 204, body: '' }));

let gatewayFailuresLeft = 0;
const ocrAttempts = [];
await context.route('**/api/ocr/page', async (route) => {
  const at = elapsed();
  if (gatewayFailuresLeft > 0) {
    gatewayFailuresLeft -= 1;
    ocrAttempts.push({ at, served: 'gateway-502' });
    await route.fulfill({ status: 502, contentType: 'text/html', body: GATEWAY_BODY });
    return;
  }
  ocrAttempts.push({ at, served: 'server' });
  await route.continue();
});

const page = await context.newPage();
const snap = async (name) => { await page.screenshot({ path: shot(name), fullPage: false }); return name; };
const panelState = async () => page.evaluate(() => ({
  status: document.querySelector('[data-testid="page-ocr"]')?.getAttribute('data-ocr-status') ?? null,
  failed: document.querySelector('[data-testid="page-ocr-failed"]')?.textContent?.trim() ?? null,
  source: document.querySelector('[data-testid="page-ocr-source"]')?.getAttribute('data-source') ?? null,
}));
// 패널을 250 ms마다 읽어 끝 상태(done/failed/unavailable)까지 시간표로 남긴다.
const watchPanel = async (limitMs) => {
  const timeline = [];
  const until = Date.now() + limitMs;
  for (;;) {
    const state = await panelState();
    const last = timeline.at(-1);
    if (!last || last.status !== state.status) timeline.push({ at: elapsed(), ...state });
    if (state.status && state.status !== 'pending') return { timeline, final: state };
    if (Date.now() > until) return { timeline, final: state, timedOut: true };
    await page.waitForTimeout(250);
  }
};
const openDialog = async () => {
  const button = page.getByTestId('page-ocr-open');
  await button.waitFor({ state: 'visible', timeout: 30_000 });
  await button.click();
  await page.getByTestId('page-ocr-dialog').waitFor({ state: 'visible', timeout: 10_000 });
};
const closeDialog = async () => {
  const dialog = page.getByTestId('page-ocr-dialog');
  await dialog.getByRole('button', { name: TEXT.close }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
};

try {
  await runStep('1_open_viewer', async () => {
    await page.goto(viewerUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByTestId('page-ocr-open').waitFor({ state: 'visible', timeout: 60_000 });
    return { url: viewerUrl, screenshot: await snap('viewer.png') };
  });

  // 서버가 이미 캐시한 페이지도 같은 경로를 탄다: 캐시 여부는 이 단계의 판정 대상이 아니다.
  await runStep('2_recovers_after_two_gateway_502', async () => {
    ocrAttempts.length = 0;
    gatewayFailuresLeft = 2;
    await openDialog();
    const seen = await watchPanel(60_000);
    const state = { attempts: [...ocrAttempts], timeline: seen.timeline, final: seen.final, screenshot: await snap('recovered.png') };
    try {
      assert.equal(seen.final.status, 'done', '두 번의 502 뒤 패널이 done 이어야 한다');
      assert.deepEqual(ocrAttempts.map((attempt) => attempt.served), ['gateway-502', 'gateway-502', 'server']);
      // 1 s + 2 s 백오프: 첫 시도와 성공 사이가 적어도 2.8 s.
      assert.ok(ocrAttempts[2].at - ocrAttempts[0].at >= 2800, `백오프가 짧다: ${ocrAttempts[2].at - ocrAttempts[0].at} ms`);
      assert.ok(!seen.timeline.some((entry) => entry.status === 'failed'), '회복되는 동안 실패를 보여서는 안 된다');
    } catch (error) { error.partial = state; throw error; }
    await closeDialog();
    return state;
  });

  // 모든 시도를 막으면 1+2+4+8+15 s 백오프 뒤 포기한다(약 30 s). 문구는 ko 번역이어야 한다.
  await runStep('3_gives_up_with_korean_message', async () => {
    ocrAttempts.length = 0;
    gatewayFailuresLeft = 99;
    await openDialog();
    const seen = await watchPanel(90_000);
    const state = { attempts: [...ocrAttempts], timeline: seen.timeline, final: seen.final, screenshot: await snap('gave-up.png') };
    try {
      assert.equal(seen.final.status, 'failed', '모든 시도가 막히면 failed 여야 한다');
      assert.equal(seen.final.failed, TEXT.unreachable, '실패 문구가 ko 번역이어야 한다');
      assert.equal(ocrAttempts.length, 6, '첫 시도 + 재시도 5회여야 한다');
    } catch (error) { error.partial = state; throw error; }
    gatewayFailuresLeft = 0;
    await closeDialog();
    return state;
  });
} finally {
  results.finishedAtIso = new Date().toISOString();
  results.totalMs = elapsed();
  results.verdict = results.verdict ?? 'PASS';
  await writeFile(new URL('results.json', output), JSON.stringify(results, null, 2), 'utf8');
  await context.close();
  await browser.close();
  console.log(`verdict: ${results.verdict}`);
  console.log(`report: ${decodeURIComponent(new URL('results.json', output).pathname.slice(1))}`);
}
