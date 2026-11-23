import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// 마이클립의 독립 OCR 모달과 상세 모달의 레이아웃 및 메모 초안을 검증한다.
// 기대 글은 화면이 아니라 `GET /api/bookmarks`의 그 클립 `ocr.text`에서 가져온다.
// 쓰기: 대상 클립에 OCR이 없으면 창의 "텍스트 읽기"로 `POST /api/bookmarks/:id/ocr`을 한 번 보낸다(그 클립의 OCR 상태만 바뀐다).
const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const channel = process.env.PDFIT_TEST_CHANNEL ?? 'chrome';
const runId = process.env.PDFIT_TEST_RUN ?? `${new Date().toISOString().slice(11, 19).replaceAll(':', '')}_clip-ocr-dialog`;
const waitMs = Number(process.env.PDFIT_TEST_OCR_WAIT_MS ?? 360_000);
const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()).replaceAll('-', '');
const output = new URL(`../../../test/${date}/${runId}/`, import.meta.url);
await mkdir(output, { recursive: true });
const shot = (name) => fileURLToPath(new URL(name, output));
const listBookmarks = async () => { const body = await (await fetch(`${origin}/api/bookmarks`)).json(); return Array.isArray(body) ? body : body.bookmarks; };

const before = await listBookmarks();
const clipId = process.env.PDFIT_TEST_CLIP_ID ?? before[0]?.id;
const clip = before.find((item) => item.id === clipId);
assert.ok(clip, 'a clip exists');
const result = { runId, origin, clipId, page: clip.pageIndex + 1, ocrBefore: clip.ocr?.status, steps: {}, pageErrors: [], writes: [] };

const panelOf = (page) => page.evaluate(() => {
  const q = (id) => document.querySelector(`[data-testid="${id}"]`);
  const text = q('clip-ocr-text');
  const bounds = (element) => element ? ['x', 'y', 'width', 'height'].map((key) => Math.round(element.getBoundingClientRect()[key])) : null;
  return {
    status: q('clip-ocr')?.getAttribute('data-ocr-status') ?? null,
    text: text?.textContent ?? null,
    userSelect: text ? getComputedStyle(text).userSelect : null,
    source: q('clip-ocr-source')?.getAttribute('data-source') ?? null,
    dialog: bounds(q('bookmark-preview-dialog')?.querySelector('[role="dialog"]')),
    image: bounds(q('bookmark-preview-image-frame')),
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
    const cards = page.getByTestId('bookmark-library-card');
    await cards.first().waitFor({ timeout: 30_000 });
    const card = cards.filter({ has: page.locator(`img[src=${JSON.stringify(clip.imageUrl)}]`) });
    await card.click();
    await page.getByTestId('bookmark-preview-dialog').waitFor({ state: 'visible' });
    await page.getByTestId('bookmark-preview-image').evaluate((image) => image.decode());
    const memo = page.getByRole('textbox', { name: '메모' });
    const draft = 'OCR 모달을 닫아도 남는 편집 내용';
    await memo.fill(draft);
    const closed = await panelOf(page);
    const button = page.getByRole('button', { name: '텍스트 보기' });
    await button.click();
    const ocrDialog = page.getByTestId('clip-text-pane');
    await ocrDialog.getByRole('dialog').waitFor();
    const step = { closed, opened: await panelOf(page) };

    if (step.opened.status === 'none') {
      step.readClicked = true;
      const started = Date.now();
      await page.getByRole('button', { name: '텍스트 읽기' }).click();
      await page.waitForFunction(() => document.querySelector('[data-testid="clip-ocr"]')?.getAttribute('data-ocr-status') === 'pending', null, { timeout: 15_000 });
      step.pendingAfterMs = Date.now() - started;
      await page.screenshot({ path: shot(`${viewport.name}-pending.png`), animations: 'disabled' });
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
    await page.screenshot({ path: shot(`${viewport.name}-open.png`), animations: 'disabled' });
    if (viewport.name === 'desktop') await page.keyboard.press('Escape');
    else await page.getByTestId('clip-text-pane-close').click();
    await ocrDialog.waitFor({ state: 'hidden' });
    step.afterClose = await panelOf(page);
    step.draftPreserved = await memo.inputValue() === draft;
    step.focusRestored = await page.getByTestId('bookmark-preview-text').evaluate((element) => document.activeElement === element);
    result.steps[viewport.name] = step;
    await context.close();
  }
} finally {
  await browser.close();
  const savedOcr = (await listBookmarks()).find((item) => item.id === clipId)?.ocr;
  result.ocrAfter = savedOcr?.status;
  for (const step of Object.values(result.steps)) {
    step.final.textMatchesApi = step.final.text === savedOcr?.text;
    step.final.textLength = step.final.text?.length ?? 0;
    delete step.final.text;
    delete step.opened.text;
  }
  await writeFile(new URL('result.json', output), JSON.stringify(result, null, 2));
}

for (const step of Object.values(result.steps)) {
  assert.equal(step.final.status, 'done');
  assert.equal(step.final.textMatchesApi, true);
  assert.equal(step.final.userSelect, 'text');
  assert.ok(step.selectionLength > 0, 'the text can be selected');
  assert.deepEqual(step.opened.dialog, step.closed.dialog, 'opening OCR leaves the detail size and position intact');
  assert.deepEqual(step.opened.image, step.closed.image, 'opening OCR leaves the capture size and position intact');
  assert.deepEqual(step.afterClose.image, step.closed.image);
  assert.ok(step.draftPreserved);
  assert.ok(step.focusRestored);
  assert.ok(step.final.overflow <= 0, 'no horizontal overflow');
}
assert.deepEqual(result.pageErrors, []);
assert.ok(result.writes.every((write) => write === `POST /api/bookmarks/${clipId}/ocr`), `only the OCR request is written: ${result.writes}`);
console.log(JSON.stringify(result, null, 2));
