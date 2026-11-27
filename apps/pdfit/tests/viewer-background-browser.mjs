import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15234';
const url = `${origin}/viewer/Fixture/fixture.pdf`;
const output = resolve(process.env.PDFIT_TEST_OUTPUT ?? 'test/20261127/viewer-background-headless-browser-test');
const evidence = {};
const errors = [];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });

function watch(page) {
  page.on('pageerror', (error) => errors.push(error.message));
}

async function waitForPage(page, mode) {
  const status = page.getByRole('status', { name: 'viewer status' });
  await status.filter({ hasText: /Backend:\s*webgpu.*Quality:\s*detail.*Pages:/ }).waitFor({ state: 'attached' });
  const shell = page.getByTestId('pdfgpu-page-shell').filter({ visible: true }).first();
  await shell.waitFor();
  if (mode) await page.getByRole('button', { name: mode }).waitFor();
  return shell;
}

async function screenshot(page, name, points) {
  const png = await page.screenshot({ animations: 'disabled', path: resolve(output, name + '.png') });
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return Object.fromEntries(Object.entries(points).map(([key, { x, y }]) => {
    assert.ok(x >= 0 && y >= 0 && x < info.width && y < info.height, `${key} is outside the screenshot`);
    const offset = (Math.floor(y) * info.width + Math.floor(x)) * info.channels;
    return [key, [...data.subarray(offset, offset + 3)]];
  }));
}

async function openPalette(page) {
  await page.getByRole('button', { name: '배경색', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '배경색' });
  await dialog.waitFor();
  assert.equal(await dialog.getByRole('button').count(), 20);
  return dialog;
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1020 }, locale: 'ko-KR', colorScheme: 'light' });
  await context.addInitScript(() => localStorage.setItem('pdfit.language', 'ko'));
  await context.route('**/api/viewer-state/**', (route) => route.fulfill({
    json: { page: 1, scale: 1, viewMode: 'single', fitMode: 'none', scrollTop: 0, inverted: false },
  }));
  const page = await context.newPage();
  watch(page);
  let reads = 0;
  page.on('response', (response) => {
    if (response.request().method() === 'GET' && response.headers()['content-type']?.includes('application/pdf')) reads += 1;
  });
  await page.goto(url);
  const shell = await waitForPage(page, '배경색');
  const reader = page.getByTestId('pdfgpu-scroll-area');
  const bounds = await shell.boundingBox();
  const viewport = await reader.boundingBox();
  const pointY = Math.max(viewport.y, bounds.y) + 100;
  const points = {
    side: { x: viewport.x + viewport.width - 48, y: pointY },
    page: { x: bounds.x + 16, y: pointY },
  };
  assert.ok(points.side.x > bounds.x + bounds.width);
  const before = await screenshot(page, 'default', points);
  assert.deepEqual(before.side, [58, 58, 58]);
  const scrollBefore = await reader.evaluate((node) => ({ x: node.scrollLeft, y: node.scrollTop }));
  const readsBefore = reads;
  const palette = await openPalette(page);
  assert.equal(await palette.getByRole('button', { name: '어두운 회색', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.screenshot({ animations: 'disabled', path: resolve(output, 'palette.png') });
  await palette.getByRole('button', { name: '남색', exact: true }).press('Enter');
  await palette.waitFor({ state: 'hidden' });
  const navy = await screenshot(page, 'navy', points);
  assert.deepEqual(navy, { side: [30, 41, 59], page: before.page });
  assert.deepEqual(await reader.evaluate((node) => ({ x: node.scrollLeft, y: node.scrollTop })), scrollBefore);
  assert.equal(reads, readsBefore);

  const second = await context.newPage();
  watch(second);
  await second.goto(`${origin}/viewer/Fixture/another.pdf`);
  await waitForPage(second, '배경색');
  const saved = await openPalette(second);
  assert.equal(await saved.getByRole('button', { name: '남색', exact: true }).getAttribute('aria-pressed'), 'true');
  await saved.getByRole('button', { name: '모래색', exact: true }).click();
  await saved.waitFor({ state: 'hidden' });
  await second.reload();
  await waitForPage(second, '배경색');
  const reloaded = await openPalette(second);
  assert.equal(await reloaded.getByRole('button', { name: '모래색', exact: true }).getAttribute('aria-pressed'), 'true');
  await second.keyboard.press('Escape');
  await reloaded.waitFor({ state: 'hidden' });
  await second.close();
  await page.bringToFront();
  const synced = await screenshot(page, 'synced', points);
  assert.deepEqual(synced, { side: [199, 174, 138], page: navy.page });

  await page.getByRole('button', { name: '이미지 조정', exact: true }).click();
  const image = page.getByRole('dialog', { name: '이미지 조정' });
  await image.getByRole('button', { name: '야간', exact: true }).click();
  await page.keyboard.press('Escape');
  await image.waitFor({ state: 'hidden' });
  const night = await screenshot(page, 'night', points);
  assert.deepEqual(night.side, synced.side);
  assert.ok(night.page.every((value, index) => value < synced.page[index]));

  await page.getByRole('button', { name: '두 페이지 보기', exact: true }).click();
  await waitForPage(page);
  const left = await page.getByTestId('pdfgpu-page-shell').first().boundingBox();
  const right = await page.getByTestId('pdfgpu-page-shell').nth(1).boundingBox();
  assert.ok(left.x + left.width < right.x);
  const gap = await screenshot(page, 'spread', {
    gap: { x: (left.x + left.width + right.x) / 2, y: Math.max(viewport.y, left.y, right.y) + 100 },
  });
  assert.deepEqual(gap.gap, synced.side);

  await page.setViewportSize({ width: 375, height: 812 });
  const mobile = await openPalette(page);
  const position = await mobile.boundingBox();
  assert.ok(position.x >= 0 && position.x + position.width <= 375);
  await page.screenshot({ animations: 'disabled', path: resolve(output, 'mobile-palette.png') });
  await mobile.getByRole('button', { name: '어두운 회색', exact: true }).click();
  await mobile.waitFor({ state: 'hidden' });
  const reset = await openPalette(page);
  assert.equal(await reset.getByRole('button', { name: '어두운 회색', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.deepEqual(errors, []);
  Object.assign(evidence, { before, navy, night, synced, gap, readsDuringChange: 0, swatches: 20, mobileWidth: 375 });
} finally {
  await writeFile(resolve(output, 'background-result.json'), JSON.stringify({ url, browser: browser.version(), errors, ...evidence }, null, 2));
  await browser.close();
}
