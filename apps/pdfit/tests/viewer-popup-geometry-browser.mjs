import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const { PDFIT_TEST_ORIGIN: origin, PDFIT_TEST_ARTIFACT_DIR: artifacts, PDFIT_TEST_CHANNEL: channel } = process.env;
assert.ok(origin && artifacts, 'Set PDFIT_TEST_ORIGIN and PDFIT_TEST_ARTIFACT_DIR for a disposable Free instance.');
await mkdir(artifacts, { recursive: true });

const definitions = [
  { id: 'bot', trigger: (p) => p.getByRole('button', { name: 'Bot', exact: true }), name: 'Bot', min: [320, 300] },
  { id: 'comments', trigger: (p) => p.getByRole('button', { name: 'Comments', exact: true }), name: 'Comments', min: [320, 300] },
  { id: 'ocr', trigger: (p) => p.getByTestId('page-ocr-open'), name: /^Page 1 text$/i, min: [340, 280] },
  { id: 'outline', trigger: (p) => p.getByTestId('viewer-outline-open'), name: 'Table of contents', min: [300, 260] },
];
const selected = (process.env.PDFIT_TEST_POPUPS ?? '').split(',').filter(Boolean);
const large = { width: 1440, height: 1000 };
const small = { width: 285, height: 310 };
const results = [];
const errors = [];
const browser = await chromium.launch({ ...(channel ? { channel } : {}), args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader'] });
const context = await browser.newContext({ baseURL: origin, viewport: large, locale: 'en-US' });
context.setDefaultTimeout(10_000);
await context.tracing.start({ screenshots: true, snapshots: true });
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(error.message));

async function bounds(locator) {
  const box = await locator.boundingBox();
  assert.ok(box, `No visible box for ${locator}`);
  return box;
}

async function drag(handle, dx, dy) {
  const box = await bounds(handle);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try { await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 }); }
  finally { await page.mouse.up(); }
}

function assertBoxes(actual, expected, message) {
  for (const coordinate of ['x', 'y', 'width', 'height']) {
    assert.ok(Math.abs(actual[coordinate] - expected[coordinate]) <= 1,
      `${message}: ${coordinate} ${actual[coordinate]} vs ${expected[coordinate]}`);
  }
}

async function waitForBox(locator, expected) {
  await locator.evaluate((element, target) => new Promise((resolve, reject) => {
    const start = performance.now();
    const check = () => {
      const rect = element.getBoundingClientRect();
      if (['x', 'y', 'width', 'height'].every((key) => Math.abs(rect[key] - target[key]) <= 1)) return resolve();
      if (performance.now() - start > 3000) return reject(new Error(`Popup did not return to ${JSON.stringify(target)}`));
      requestAnimationFrame(check);
    };
    check();
  }), expected);
}

async function goTo(book, engine) {
  await page.goto(`/viewer/Fixture/Popup%20${book}.pdf${engine === 'gpu' ? '?engine=gpu' : ''}`);
  await page.getByTestId(engine === 'gpu' ? 'pdfgpu-scroll-area' : 'pdf-scroll-area').waitFor();
}

async function checkPopup(definition, engine) {
  const { trigger, name, id } = definition;
  const popup = page.getByRole('dialog', { name, exact: true });
  const resize = popup.getByRole('button', { name: 'Resize popup', exact: true });
  const close = popup.getByRole('button', { name: 'Close', exact: true });

  async function open() {
    await trigger(page).click();
    await resize.waitFor();
    assert.notEqual(await popup.getAttribute('aria-modal'), 'true');
    assert.equal(await close.count(), 1);
  }
  async function dismiss() {
    const box = await bounds(popup);
    const button = await bounds(close);
    assert.ok(button.x > box.x + box.width - 65 && button.y < box.y + 48, 'Close is at the upper right');
    await close.click();
    await popup.waitFor({ state: 'hidden' });
  }

  await goTo('A', engine);
  await open();
  const initial = await bounds(popup);
  const move = popup.getByTitle(/^Move\b/i);
  await drag(move, id === 'bot' || id === 'comments' ? -135 : 80, 40);
  const moved = await bounds(popup);
  assert.ok(Math.abs(moved.x - initial.x) > 40 && Math.abs(moved.y - initial.y) > 25, `${id}: pointer move`);

  await drag(resize, -moved.width + 40, -moved.height + 60);
  const minimum = await bounds(popup);
  assert.deepEqual([minimum.width, minimum.height], definition.min, `${id}: minimum size`);
  assert.ok(minimum.width < moved.width && minimum.height < moved.height, `${id}: shrink in both axes`);
  assert.equal(minimum.x, moved.x, `${id}: resize keeps the left edge`);
  assert.equal(minimum.y, moved.y, `${id}: resize keeps the top edge`);

  await drag(resize, 49, 57);
  const larger = await bounds(popup);
  assert.ok(larger.width > minimum.width + 40 && larger.height > minimum.height + 45, `${id}: grow in both axes`);
  await resize.press('ArrowRight');
  const saved = await bounds(popup);
  assert.equal(saved.width, larger.width + 5, `${id}: keyboard resize`);
  await page.screenshot({ path: path.join(artifacts, `${engine}-${id}.png`) });

  await dismiss();
  await open();
  assertBoxes(await bounds(popup), saved, `${id}: reopen`);
  await page.setViewportSize(small);
  await page.waitForFunction(() => {
    const dialog = document.querySelector('[role=dialog]');
    if (!dialog) return false;
    const rect = dialog.getBoundingClientRect();
    return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
  });
  assert.ok((await bounds(popup)).width < saved.width, `${id}: temporarily fit a narrow viewport`);
  await dismiss();
  await page.setViewportSize(large);
  await open();
  await waitForBox(popup, saved);
  await dismiss();

  await goTo('B', engine);
  await open();
  assertBoxes(await bounds(popup), initial, `${id}: the second book uses the default`);
  await dismiss();
  await goTo('A', engine);
  await open();
  assertBoxes(await bounds(popup), saved, `${id}: restored after navigating and loading a new document`);
  await dismiss();
  results.push({ id, engine, initial, moved, minimum, saved });
  console.log(`PASS ${engine} ${id}`);
}

try {
  for (const engine of ['legacy', 'gpu']) {
    await context.clearCookies();
    await page.goto('/health');
    await page.evaluate(() => localStorage.clear());
    for (const definition of definitions) {
      if (!selected.length || selected.includes(definition.id)) await checkPopup(definition, engine);
    }
  }
  assert.deepEqual(errors, []);
} catch (error) {
  await page.screenshot({ path: path.join(artifacts, 'failure.png') });
  throw error;
} finally {
  await writeFile(path.join(artifacts, 'results.json'), JSON.stringify({ origin, results, errors }, null, 2));
  await context.tracing.stop({ path: path.join(artifacts, 'trace.zip') });
  await browser.close();
}
