import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// 마이클립 상세 모달의 "텍스트 보기" 버튼과 옆 텍스트 창을 배포된 Free 서버에서 검증한다.
// 요구(2026-11-13 사용자): "클립의 상세모달에서 텍스트보기라는 버튼으로 옆에 선택가능한 ocr텍스트 결과를 보여주는 추가 창을 띄우게 한다."
// 기대 글은 화면이 아니라 `GET /api/bookmarks`의 그 클립 `ocr.text`에서 가져온다.
// 쓰기: 대상 클립에 OCR이 없으면 창의 "텍스트 읽기"로 `POST /api/bookmarks/:id/ocr`을 한 번 보낸다(그 클립의 OCR 상태만 바뀐다).
const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const channel = process.env.PDFIT_TEST_CHANNEL ?? 'chrome';
const runId = process.env.PDFIT_TEST_RUN ?? '20261113_clip-text-pane';
const waitMs = Number(process.env.PDFIT_TEST_OCR_WAIT_MS ?? 360_000);
const output = new URL(`./reports/clip-text-pane/${runId}/`, import.meta.url);
await mkdir(output, { recursive: true });
const shot = (name) => decodeURIComponent(new URL(name, output).pathname.slice(1));
const listBookmarks = async () => { const body = await (await fetch(`${origin}/api/bookmarks`)).json(); return Array.isArray(body) ? body : body.bookmarks; };

const before = await listBookmarks();
const clipId = process.env.PDFIT_TEST_CLIP_ID ?? before[0]?.id;
const clip = before.find((item) => item.id === clipId);
assert.ok(clip, 'a clip exists');
const result = { runId, origin, clipId, filename: clip.filename, page: clip.pageIndex + 1, ocrBefore: clip.ocr, steps: {}, pageErrors: [], writes: [] };

const panelOf = (page) => page.evaluate(() => {
  const q = (id) => document.querySelector(`[data-testid="${id}"]`);
  const text = q('clip-ocr-text');
  const dialog = q('bookmark-preview-dialog');
  const pane = q('clip-text-pane')?.getBoundingClientRect();
  const image = q('bookmark-preview-image-frame')?.getBoundingClientRect();
  return {
    paneOpen: dialog?.getAttribute('data-text-pane') ?? null,
    status: q('clip-ocr')?.getAttribute('data-ocr-status') ?? null,
    text: text?.textContent ?? null,
    userSelect: text ? getComputedStyle(text).userSelect : null,
    source: q('clip-ocr-source')?.getAttribute('data-source') ?? null,
    pane: pane ? { left: Math.round(pane.left), top: Math.round(pane.top), width: Math.round(pane.width) } : null,
    image: image ? { left: Math.round(image.left), right: Math.round(image.right), top: Math.round(image.top), bottom: Math.round(image.bottom) } : null,
    buttonLabel: q('bookmark-preview-text')?.textContent ?? null,
    expanded: q('bookmark-preview-text')?.getAttribute('aria-expanded') ?? null,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  };
});

const browser = await chromium.launch({ channel, headless: true });
try {
  for (const viewport of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 375, height: 812 }]) {
    const context = await browser.newContext({ locale: 'ko-KR', viewport, colorScheme: 'dark' });
    await context.addInitScript(() => { try { localStorage.setItem('pdfit.language', 'ko'); } catch {} });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    const page = await context.newPage();
    page.on('pageerror', (error) => result.pageErrors.push(String(error)));
    page.on('request', (request) => { if (!['GET', 'HEAD'].includes(request.method()) && !request.url().includes('/api/settings/translations')) result.writes.push(`${request.method()} ${new URL(request.url()).pathname}`); });
    await page.goto(`${origin}/bookmarks`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('bookmark-library-card').first().waitFor({ timeout: 30_000 });
    await page.getByTestId('bookmark-library-card').first().click();
    await page.getByTestId('bookmark-preview-dialog').waitFor({ state: 'visible' });
    const closed = await panelOf(page);
    const button = page.getByRole('button', { name: '텍스트 보기' });
    await button.click();
    await page.getByTestId('clip-text-pane').waitFor();
    const step = { closed, opened: await panelOf(page) };

    if (step.opened.status === 'none') {
      step.readClicked = true;
      const started = Date.now();
      await page.getByRole('button', { name: '텍스트 읽기' }).click();
      await page.waitForFunction(() => document.querySelector('[data-testid="clip-ocr"]')?.getAttribute('data-ocr-status') === 'pending', null, { timeout: 15_000 });
      step.pendingAfterMs = Date.now() - started;
      await page.screenshot({ path: shot(`${viewport.name}-pending.png`) });
      await page.waitForFunction(() => ['done', 'failed', 'unavailable'].includes(document.querySelector('[data-testid="clip-ocr"]')?.getAttribute('data-ocr-status')), null, { timeout: waitMs });
      step.settledAfterMs = Date.now() - started;
    } else if (step.opened.status === 'pending') {
      await page.waitForFunction(() => document.querySelector('[data-testid="clip-ocr"]')?.getAttribute('data-ocr-status') !== 'pending', null, { timeout: waitMs });
    }
    step.final = await panelOf(page);
    // Selectable: select the text by triple click and read the selection.
    if (step.final.text) {
      await page.getByTestId('clip-ocr-text').click({ clickCount: 3 });
      step.selectionLength = await page.evaluate(() => window.getSelection()?.toString().length ?? 0);
    }
    await page.screenshot({ path: shot(`${viewport.name}-open.png`) });
    await page.getByTestId('clip-text-pane-close').click();
    step.afterClose = await panelOf(page);
    result.steps[viewport.name] = step;
    await context.close();
  }
} finally {
  await browser.close();
  result.ocrAfter = (await listBookmarks()).find((item) => item.id === clipId)?.ocr ?? null;
  await writeFile(new URL('result.json', output), JSON.stringify(result, null, 2));
}

const { desktop, mobile } = result.steps;
assert.equal(desktop.closed.paneOpen, 'closed');
assert.equal(desktop.closed.buttonLabel, '텍스트 보기');
assert.equal(desktop.opened.paneOpen, 'open');
assert.equal(desktop.opened.expanded, 'true');
assert.equal(desktop.final.status, 'done', 'the clip text was read');
assert.equal(desktop.final.text, result.ocrAfter.text, 'pane text = API ocr.text');
assert.equal(desktop.final.userSelect, 'text');
assert.ok(desktop.selectionLength > 0, 'the text can be selected');
assert.ok(desktop.final.pane.left >= desktop.final.image.right, 'at 1440 px the pane sits right of the clip');
assert.equal(desktop.afterClose.paneOpen, 'closed');
assert.equal(mobile.final.status, 'done');
assert.equal(mobile.final.text, result.ocrAfter.text);
assert.ok(mobile.final.pane.top >= mobile.final.image.bottom, 'at 375 px the pane is stacked under the clip');
assert.ok(mobile.final.overflow <= 0, 'no horizontal overflow at 375 px');
assert.deepEqual(result.pageErrors, []);
assert.ok(result.writes.every((write) => write === `POST /api/bookmarks/${clipId}/ocr`), `only the OCR request is written: ${result.writes}`);
console.log(JSON.stringify({ ...result, steps: Object.fromEntries(Object.entries(result.steps).map(([name, step]) => [name, { ...step, final: { ...step.final, text: step.final.text?.slice(0, 80) } }])) }, null, 2));
