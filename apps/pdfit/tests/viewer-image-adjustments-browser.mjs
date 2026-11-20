import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const folder = 'Toolbar fixture';
const filename = 'Image colors.pdf';
const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15213';
const viewerURL = `${origin}/viewer/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`;
const fixtureRoot = process.env.PDFIT_IMAGE_FIXTURE_ROOT;
const channel = process.env.PDFIT_TEST_CHANNEL ?? 'chrome';
const browser = await chromium.launch(fixtureRoot ? {} : { channel, args: ['--enable-unsafe-webgpu'] });

try {
  if (fixtureRoot) {
    const page = await browser.newPage();
    await page.setContent('<style>@page { size: A4; margin: 0 } html { background: rgb(64,128,192); print-color-adjust: exact; }</style>');
    const directory = join(fixtureRoot, folder);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, filename), await page.pdf({ printBackground: true, preferCSSPageSize: true }), { flag: 'wx' });
  } else {
    await verifyViewer();
  }
} finally {
  await browser.close();
}

async function verifyViewer() {
  const run = process.env.PDFIT_TEST_RUN ?? new Date().toISOString().replaceAll(/\D/g, '').slice(0, 14);
  const output = new URL(`../../../test/${run.slice(0, 8)}/${run.slice(8)}_viewer-image-adjustments/`, import.meta.url);
  await mkdir(output, { recursive: true });
  const results = [];
  for (const fixture of [
    { engine: 'legacy', mode: 'pdfjs' },
    { engine: 'gpu', mode: 'webgpu' },
    { engine: 'gpu', mode: 'canvas2d' },
  ]) {
    const context = await browser.newContext({ locale: 'ko-KR', colorScheme: 'dark', viewport: { width: 1440, height: 900 } });
    try {
      await context.addInitScript((useCanvas) => {
        localStorage.setItem('pdfit.language', 'ko');
        localStorage.setItem('pdfit.color-mode', 'dark');
        if (useCanvas) Object.defineProperty(navigator, 'gpu', { value: undefined });
      }, fixture.mode === 'canvas2d');
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const adapter = fixture.mode === 'webgpu' ? await getAdapter(page) : null;
      await page.goto(`${viewerURL}?engine=${fixture.engine}&page=1`);
      const toolbar = page.getByRole('toolbar', { name: 'viewer controls' });
      await toolbar.getByTestId('viewer-page-indicator').getByText('/ 1', { exact: true }).waitFor();
      await page.getByTestId('viewer-load-progress-panel').waitFor({ state: 'hidden' });
      if (fixture.engine === 'gpu') {
        const expected = fixture.mode === 'webgpu' ? 'webgpu' : 'unsupported';
        await page.getByRole('status', { name: 'viewer status' }).filter({ hasText: `Backend: ${expected}` }).waitFor({ state: 'attached' });
      }
      const trigger = toolbar.getByRole('button', { name: '이미지 조정' });
      const dialog = page.getByRole('dialog', { name: '이미지 조정' });
      await trigger.getByText('Image', { exact: true }).waitFor();
      await trigger.click();
      const reset = dialog.getByRole('button', { name: '초기화' });
      if (await reset.isEnabled()) await reset.click();
      const baseline = await expectPixel(page, [64, 128, 192]);
      const invert = dialog.getByRole('switch', { name: '색상 반전' });
      await invert.check();
      const inverted = await expectPixel(page, [191, 127, 63]);
      const filter = await page.locator(fixture.engine === 'gpu' ? '[data-testid="pdfgpu-scroll-area"] > canvas' : '[data-pdf-page] > canvas').first().evaluate((canvas) => getComputedStyle(canvas).filter);
      if (fixture.mode === 'webgpu') assert.equal(filter, 'none', 'WebGPU has no second browser filter');
      else assert.match(filter, /^url\(/, 'canvas path has one display filter');
      await reset.click();
      const brightness = dialog.getByRole('slider', { name: '밝기' });
      await brightness.press('ArrowRight');
      assert.equal(await brightness.inputValue(), '1');
      const brightened = await expectPixel(page, [67, 131, 195]);
      const highContrast = dialog.getByRole('button', { name: '고대비' });
      await highContrast.click();
      assert.equal(await highContrast.getAttribute('aria-pressed'), 'true');
      const contrasted = await expectPixel(page, [39, 128, 218]);
      const contrast = dialog.getByRole('slider', { name: '대비' });
      await contrast.press('End');
      assert.equal(await contrast.inputValue(), '200');
      const maxContrast = await expectPixel(page, [1, 129, 255]);
      const grayscale = dialog.getByRole('button', { name: '흑백' });
      await grayscale.click();
      const desaturated = await expectPixel(page, [119, 119, 119]);
      await page.mouse.move(840, 550);
      await page.screenshot({ animations: 'disabled', path: fileURLToPath(new URL(`${fixture.mode}-desktop.png`, output)) });

      await reset.click();
      await expectPixel(page, baseline);
      const saturation = dialog.getByRole('slider', { name: '채도' });
      await saturation.press('Home');
      assert.equal(await saturation.inputValue(), '0');
      await expectPixel(page, desaturated);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      await page.setViewportSize({ width: 375, height: 800 });
      await trigger.click();
      const night = dialog.getByRole('button', { name: '야간' });
      const savedInversion = fixture.mode === 'pdfjs' ? page.waitForResponse((response) => {
        const request = response.request();
        return request.method() === 'PUT' && new URL(request.url()).pathname.startsWith('/api/viewer-state/') && request.postDataJSON().inverted === true && response.ok();
      }) : null;
      await night.click();
      assert.equal(await night.getAttribute('aria-pressed'), 'true');
      assert.equal(await invert.isChecked(), true);
      assert.equal(await brightness.inputValue(), '-8');
      assert.equal(await saturation.inputValue(), '75');
      const bounds = await dialog.boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 375 && bounds.y + bounds.height <= 800);
      await page.mouse.move(370, 700);
      await page.screenshot({ animations: 'disabled', path: fileURLToPath(new URL(`${fixture.mode}-mobile.png`, output)) });

      if (savedInversion) {
        await savedInversion;
        await page.reload();
        await trigger.click();
        assert.equal(await invert.isChecked(), true);
        assert.equal(await brightness.inputValue(), '0');
        assert.equal(await saturation.inputValue(), '100');
      }
      await reset.click();
      assert.equal(await reset.getAttribute('aria-disabled'), 'true');
      assert.equal(await reset.evaluate((button) => button === document.activeElement), true);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
      assert.deepEqual(errors, []);
      results.push({ ...fixture, adapter, baseline, inverted, brightened, contrasted, maxContrast, desaturated, pageErrors: errors });
      console.log(`PASS ${fixture.mode}: pixel checks, keyboard, mobile panel, reset`);
    } finally {
      await context.close();
    }
  }
  await writeFile(new URL('result.json', output), JSON.stringify({ origin, results }, null, 2));
}

async function getAdapter(page) {
  await page.goto(`${origin}/health`);
  const adapter = await page.evaluate(async () => {
    const gpu = await navigator.gpu?.requestAdapter();
    return gpu && { vendor: gpu.info.vendor, architecture: gpu.info.architecture };
  });
  assert.ok(adapter, 'The WebGPU case requires an available adapter.');
  return adapter;
}

async function expectPixel(page, expected) {
  let actual;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const png = await page.screenshot({ clip: { x: 840, y: 550, width: 1, height: 1 } });
    actual = [...(await sharp(png).removeAlpha().raw().toBuffer())];
    if (expected.every((channel, index) => Math.abs(channel - actual[index]) <= 2)) return actual;
  }
  assert.fail(`Expected page RGB ${expected}, got ${actual}`);
}
