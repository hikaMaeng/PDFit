// Read-only check of the cover card layout on a deployed standalone PDFit server:
// title band over the thumbnail, four equal buttons directly under it, and the info
// overlay shown by hover (pointer devices) or by the ⓘ toggle (touch devices).
//
// Usage: PDFIT_BASE_URL=http://127.0.0.1:15203 PDFIT_EVIDENCE_DIR=test/<date>/<run> \
//        node apps/pdfit/tests/cover-card-overlay-deployed-browser.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.PDFIT_BASE_URL ?? 'http://127.0.0.1:15203';
const folder = process.env.PDFIT_FOLDER ?? '이북';
const evidenceDir = process.env.PDFIT_EVIDENCE_DIR ?? 'test/cover-card-overlay';
mkdirSync(evidenceDir, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PDFIT_BROWSER_CHANNEL || undefined });
const report = [];

async function openCovers(page) {
  await page.goto(`${baseUrl}/folder/${encodeURIComponent(folder)}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '표지 보기', exact: true }).click();
  const card = page.getByTestId('pdf-cover-card').first();
  await card.waitFor();
  return card;
}

async function geometry(card) {
  const rect = (locator) => locator.evaluate((element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  const [cardBox, media, actions, title, overlay, toggle] = await Promise.all([
    rect(card), rect(card.getByTestId('pdf-cover-media')), rect(card.getByTestId('pdf-cover-actions')),
    rect(card.getByTestId('pdf-cover-title-row')), rect(card.getByTestId('pdf-cover-info-overlay')), rect(card.getByTestId('pdf-cover-info-toggle')),
  ]);
  const buttons = await card.getByTestId('pdf-cover-actions').getByRole('button').evaluateAll((elements) => elements.map((element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
  return { cardBox, media, actions, title, overlay, toggle, buttons };
}

function assertLayout(name, g) {
  assert.equal(g.buttons.length, 4, `${name}: 버튼 4종`);
  for (let i = 1; i < 4; i += 1) {
    assert.ok(Math.abs(g.buttons[i].width - g.buttons[0].width) < 1, `${name}: 버튼 폭 균등`);
    assert.ok(Math.abs(g.buttons[i].x - (g.buttons[i - 1].x + g.buttons[i - 1].width)) < 1, `${name}: 버튼 사이 빈틈 없음`);
  }
  assert.ok(Math.abs(g.actions.y - (g.media.y + g.media.height)) < 1, `${name}: 버튼이 썸네일 바로 밑`);
  assert.ok(g.cardBox.y + g.cardBox.height - (g.actions.y + g.actions.height) <= 2.5, `${name}: 카드는 버튼 행에서 끝남`);
  assert.ok(Math.abs(g.title.y + g.title.height - (g.media.y + g.media.height)) < 1, `${name}: 제목 띠가 썸네일 하단`);
  assert.ok(Math.abs(g.overlay.y + g.overlay.height - g.title.y) < 1, `${name}: 정보 영역은 제목 띠 위를 덮음`);
  assert.ok(g.toggle.x + g.toggle.width <= g.media.x + g.media.width && g.toggle.y >= g.media.y && g.toggle.x > g.media.x + g.media.width / 2, `${name}: ⓘ 버튼이 썸네일 우상단`);
  return { cardHeight: g.cardBox.height, mediaHeight: g.media.height, actionsHeight: g.actions.height, titleHeight: g.title.height, buttonWidths: g.buttons.map((b) => b.width) };
}

async function overlayText(card) {
  return (await card.getByTestId('pdf-cover-info-overlay').innerText()).replace(/\n+/g, ' | ');
}

// ---- Pointer device (desktop): hover and toggle
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR' });
  const page = await context.newPage();
  const card = await openCovers(page);
  const overlay = card.getByTestId('pdf-cover-info-overlay');
  const toggle = card.getByTestId('pdf-cover-info-toggle');
  await page.mouse.move(2, 2);
  const layout = assertLayout('desktop', await geometry(card));
  assert.equal(await overlay.isVisible(), false, 'desktop: 평소에는 정보 숨김');
  const titleStyle = await card.getByTestId('pdf-cover-title-row').evaluate((element) => { const s = getComputedStyle(element); return { background: s.backgroundColor, color: s.color }; });
  assert.match(titleStyle.background, /^rgba\(0, 0, 0, 0\.\d+\)$/);
  assert.equal(titleStyle.color, 'rgb(255, 255, 255)');
  await page.screenshot({ path: path.join(evidenceDir, 'desktop-idle.png') });

  await card.getByTestId('pdf-cover-media').hover();
  await overlay.waitFor({ state: 'visible' });
  const hoverText = await overlayText(card);
  assert.match(hoverText, /열린시간: /);
  assert.match(hoverText, /최종페이지: /);
  assert.match(hoverText, /(MB|KB)/);
  await page.screenshot({ path: path.join(evidenceDir, 'desktop-hover.png') });
  await page.mouse.move(2, 2);
  await overlay.waitFor({ state: 'hidden' });

  await toggle.click();
  await page.mouse.move(2, 2);
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  await overlay.waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(evidenceDir, 'desktop-toggle-open.png') });
  await toggle.click();
  await page.mouse.move(2, 2);
  await overlay.waitFor({ state: 'hidden' });
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  report.push({ device: 'desktop', layout, titleStyle, hoverText });
  await context.close();
}

// ---- Touch device (tablet and phone): no hover, toggle only
for (const profile of [{ name: 'tablet', viewport: { width: 820, height: 1180 } }, { name: 'phone', viewport: { width: 390, height: 844 } }]) {
  const context = await browser.newContext({ viewport: profile.viewport, hasTouch: true, isMobile: true, locale: 'ko-KR' });
  const page = await context.newPage();
  const card = await openCovers(page);
  const overlay = card.getByTestId('pdf-cover-info-overlay');
  const toggle = card.getByTestId('pdf-cover-info-toggle');
  const hoverCapable = await page.evaluate(() => matchMedia('(hover: hover)').matches);
  const layout = assertLayout(profile.name, await geometry(card));
  assert.equal(await overlay.isVisible(), false, `${profile.name}: 평소에는 정보 숨김`);
  await page.screenshot({ path: path.join(evidenceDir, `${profile.name}-idle.png`) });
  await toggle.tap();
  await overlay.waitFor({ state: 'visible' });
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  const text = await overlayText(card);
  assert.match(text, /열린시간: /);
  await page.screenshot({ path: path.join(evidenceDir, `${profile.name}-toggle-open.png`) });
  await toggle.tap();
  await overlay.waitFor({ state: 'hidden' });
  report.push({ device: profile.name, hoverCapable, layout, text });
  await context.close();
}

writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify({ baseUrl, folder, report }, null, 2), 'utf8');
console.log(JSON.stringify({ baseUrl, folder, report }, null, 2));
await browser.close();
