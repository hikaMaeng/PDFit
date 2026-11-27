import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { chromium } from 'playwright';
import sharp from 'sharp';

const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const output = resolve(process.env.PDFIT_TEST_OUTPUT ?? 'test/20261127/viewer-deskew');
const viewerUrl = `${origin}/viewer/deskew/pages.pdf?driveFileId=deskew`;
const angles = [1.2, -1.2, 0];
const width = 720;
const height = 960;
const guideY = 310;
const artifact = makePdf();

function makeScan(angle) {
  const rgb = Buffer.alloc(width * height * 3, 255);
  const slope = Math.tan(angle * Math.PI / 180);
  const baselines = [];
  for (let row = 0, y = 70; y < height - 70; row += 1) {
    if (Math.abs(y - guideY) > 14) baselines.push(y);
    y += 16 + (row * 7 % 17);
  }
  for (let x = 46; x < width - 46; x += 1) {
    const shift = Math.round((x - width / 2) * slope);
    for (const [index, baseline] of baselines.entries()) {
      if ((x + index * 7) % 41 > 32) continue;
      for (let dy = -2; dy <= 3; dy += 1) rgb.fill(22, ((baseline + shift + dy) * width + x) * 3, ((baseline + shift + dy) * width + x) * 3 + 3);
    }
    for (let dy = -2; dy <= 2; dy += 1) {
      const offset = ((guideY + shift + dy) * width + x) * 3;
      rgb[offset] = 15;
      rgb[offset + 1] = 50;
      rgb[offset + 2] = 220;
    }
  }
  return deflateSync(rgb);
}

function makePdf() {
  const pages = angles.map((_, index) => 3 + index * 3);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((id) => `${id} 0 R`).join(' ')}] >>`,
  ];
  const stream = (dictionary, bytes) => Buffer.concat([
    Buffer.from(`<< ${dictionary} /Length ${bytes.length} >>\nstream\n`), bytes, Buffer.from('\nendstream'),
  ]);
  for (const [index, angle] of angles.entries()) {
    const id = pages[index];
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 540 720] /Resources << /XObject << /Scan ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`,
      stream('', Buffer.from('q 540 0 0 720 0 0 cm /Scan Do Q')),
      stream(`/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode`, makeScan(angle)),
    );
  }
  const document = [Buffer.from('%PDF-1.4\n')];
  let offset = document[0].length;
  const offsets = ['0000000000 65535 f \n'];
  for (const [index, object] of objects.entries()) {
    const entry = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), Buffer.from(object), Buffer.from('\nendobj\n')]);
    offsets.push(`${String(offset).padStart(10, '0')} 00000 n \n`);
    document.push(entry);
    offset += entry.length;
  }
  document.push(Buffer.from(`xref\n0 ${offsets.length}\n${offsets.join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
  return Buffer.concat(document);
}

async function findGuide(png) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const columns = [0.34, 0.66].map((fraction) => Math.round(info.width * fraction));
  const center = (columns[0] + columns[1]) / 2;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let x = columns[0]; x <= columns[1]; x += 1) {
    let sum = 0;
    let count = 0;
    for (let y = 0; y < info.height; y += 1) {
      const index = (y * info.width + x) * info.channels;
      if (data[index + 2] < 125 || data[index + 2] < data[index] + 75) continue;
      sum += y;
      count += 1;
    }
    assert.ok(count >= 2, `blue scan line missing at x=${x}`);
    const y = sum / count;
    sumY += y;
    sumXY += (x - center) * y;
    sumXX += (x - center) ** 2;
  }
  const slope = sumXY / sumXX;
  const averageY = sumY / (columns[1] - columns[0] + 1);
  const rows = columns.map((x) => averageY + (x - center) * slope);
  const angle = Math.atan(slope) * 180 / Math.PI;
  return { angle, columns, rows };
}

async function drag(page, start, end) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

async function waitForGuide(shell, angle, name) {
  const deadline = Date.now() + 10000;
  let guide;
  do {
    guide = await findGuide(await shell.screenshot());
    if (Math.abs(guide.angle - angle) < 0.2) {
      return findGuide(await shell.screenshot({ path: resolve(output, name) }));
    }
  } while (Date.now() < deadline);
  assert.fail(`Expected angle ${angle}°, measured ${guide.angle}°`);
}

async function checkViewer(browser) {
  const mode = 'webgpu';
  const context = await browser.newContext({ locale: 'ko-KR', colorScheme: 'light', viewport: { width: 1440, height: 1100 } });
  try {
    await context.addInitScript(() => {
      localStorage.setItem('pdfit.language', 'ko');
      window.skewRequests = 0;
      const send = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (...args) {
        if (args[0].type === 'preview' && args[0].detectSkew === true) window.skewRequests += 1;
        return send.apply(this, args);
      };
    });
    let documentReads = 0;
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(`${origin}/api/**`, async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      if (pathname.includes('/files/') || pathname.includes('/by-id/')) {
        if (request.method() === 'GET') documentReads += 1;
        return route.fulfill({ contentType: 'application/pdf', headers: { 'content-length': String(artifact.length) }, body: request.method() === 'HEAD' ? undefined : artifact });
      }
      if (request.method() === 'POST' && pathname === '/api/annotations') return route.fulfill({ status: 201, json: request.postDataJSON() });
      if (request.method() === 'POST' && pathname.startsWith('/api/bookmarks/')) {
        return route.fulfill({ status: 201, json: { ...request.postDataJSON(), id: 'fixture-clip', folder: 'deskew', filename: 'pages.pdf', createdAt: '2026-11-27T00:00:00Z', updatedAt: '2026-11-27T00:00:00Z' } });
      }
      const viewerState = { page: 1, scale: 1, fitMode: 'none', viewMode: 'single', scrollTop: 0 };
      return route.fulfill({ json: pathname.startsWith('/api/viewer-state/') ? viewerState : /\/api\/(bookmarks|annotations|tags)/.test(pathname) ? [] : {} });
    });

    const status = page.getByRole('status', { name: 'viewer status' });
    const deskew = page.getByRole('button', { name: '기울임 보정', exact: true });
    const background = page.getByRole('button', { name: '배경색', exact: true });
    const pageNumberInput = page.getByRole('textbox', { name: '페이지 번호' });
    const nextPage = page.getByRole('button', { name: '다음 페이지', exact: true });
    const canvas = page.getByTestId('pdfgpu-scroll-area').locator('canvas').first();
    const waitForGpuDetail = (pageNumber) => status.filter({
      hasText: `Backend: webgpu · Quality: detail · Pages: ${pageNumber} / ${angles.length}`,
    }).waitFor({ state: 'attached' });
    const result = { mode, angles: [], uncorrectedAngles: [], disabledAngles: [], errors };
    for (const [index, sourceAngle] of angles.entries()) {
      const pageNumber = index + 1;
      await page.goto(`${viewerUrl}&page=1`);
      await deskew.and(page.locator('[aria-pressed="false"]')).waitFor();
      for (let step = 0; step < index; step += 1) {
        await nextPage.click();
        await pageNumberInput.and(page.locator(`[value="${step + 2}"]`)).waitFor();
      }
      await waitForGpuDetail(pageNumber);
      await background.click();
      const palette = page.getByRole('dialog', { name: '배경색' });
      await palette.getByRole('button', { name: '가지색', exact: true }).click();
      await palette.waitFor({ state: 'hidden' });
      const shellSelector = `[data-pdfgpu-page-shell="true"][data-page-index="${index}"]`;
      const shell = page.locator(shellSelector);
      const originalGuide = await waitForGuide(shell, sourceAngle, `webgpu-off-page-${pageNumber}.png`);
      result.uncorrectedAngles.push(originalGuide.angle);
      assert.equal(await page.evaluate(() => window.skewRequests), 0, 'no worker skew request with the toggle off');

      const documentReadsBeforeToggle = documentReads;
      assert.ok(documentReadsBeforeToggle >= 1);
      const originalCanvas = await canvas.elementHandle();
      await deskew.click();
      await deskew.and(page.locator('[aria-pressed="true"]')).waitFor();
      await page.waitForFunction(() => window.skewRequests > 0);
      const guide = await waitForGuide(shell, 0, `webgpu-on-page-${pageNumber}.png`);
      const { data, info } = await sharp(await shell.screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      for (const x of [3, info.width - 4]) {
        for (const y of [3, info.height - 4]) {
          const offset = (y * info.width + x) * info.channels;
          assert.deepEqual([...data.subarray(offset, offset + 3)], [255, 255, 255], 'deskew keeps the paper corners white');
        }
      }
      assert.equal(await pageNumberInput.inputValue(), String(pageNumber));
      assert.ok(await canvas.evaluate((element, original) => element === original, originalCanvas));
      assert.equal(documentReads, documentReadsBeforeToggle, 'enabling deskew reuses the open PDF');
      result.angles.push(guide.angle);

      if (index !== 0) {
        await deskew.click();
        await deskew.and(page.locator('[aria-pressed="false"]')).waitFor();
        assert.equal(await pageNumberInput.inputValue(), String(pageNumber));
        const restored = await waitForGuide(shell, sourceAngle, `webgpu-disabled-again-${pageNumber}.png`);
        assert.ok(await canvas.evaluate((element, original) => element === original, originalCanvas));
        assert.equal(documentReads, documentReadsBeforeToggle, 'disabling deskew reuses the open PDF');
        result.disabledAngles.push(restored.angle);
        await originalCanvas.dispose();
        continue;
      }

      result.adapter = await page.evaluate(async () => {
        const adapter = await navigator.gpu.requestAdapter();
        return adapter && { vendor: adapter.info.vendor, architecture: adapter.info.architecture };
      });
      assert.ok(result.adapter);
      await originalCanvas.dispose();
      const zoom = page.getByRole('button', { name: '확대', exact: true });
      const originalSize = await shell.boundingBox();
      await zoom.click();
      await page.waitForFunction(({ selector, oldWidth }) => document.querySelector(selector)?.getBoundingClientRect().width > oldWidth, { selector: shellSelector, oldWidth: originalSize.width });
      await status.filter({ hasText: 'Quality: detail' }).waitFor({ state: 'attached' });
      const zoomed = await shell.screenshot({ path: resolve(output, `${mode}-detail.png`) });
      const zoomGuide = await findGuide(zoomed);
      assert.ok(Math.abs(zoomGuide.angle) < 0.2, `${mode} zoomed scan line is level`);
      result.zoomAngle = zoomGuide.angle;

      const box = await shell.boundingBox();
      const [start, end] = zoomGuide.columns.map((x, column) => ({ x: box.x + x, y: box.y + zoomGuide.rows[column] }));
      await page.getByRole('button', { name: '선', exact: true }).click();
      const annotationSaved = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/annotations');
      await drag(page, start, end);
      const annotation = (await annotationSaved).postDataJSON();
      assert.equal(annotation.pageIndex, 0);
      const { start: from, end: to } = annotation.geometry;
      const storedAngle = Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
      assert.ok(Math.abs(storedAngle - sourceAngle) < 0.35, `${mode} source annotation angle is ${storedAngle}°`);
      const strokeMidpoint = (from.y + to.y) / 2;
      assert.ok(Math.abs(strokeMidpoint - guideY * 720 / height) <= 2, `${mode} source annotation is on the line at y=${strokeMidpoint}`);
      const painted = await page.getByTestId('annotation-line').evaluate((line) => {
        const matrix = line.getScreenCTM();
        return [new DOMPoint(line.x1.baseVal.value, line.y1.baseVal.value), new DOMPoint(line.x2.baseVal.value, line.y2.baseVal.value)].map((point) => point.matrixTransform(matrix).toJSON());
      });
      assert.ok(Math.abs(painted[0].y - start.y) <= 2 && Math.abs(painted[1].y - end.y) <= 2, `${mode} annotation redraw follows the pointer`);
      result.annotation = { storedAngle, geometry: annotation.geometry };

      await page.getByRole('button', { name: '클립', exact: true }).click();
      const scrollArea = page.getByTestId('pdfgpu-scroll-area');
      const initialScroll = await scrollArea.evaluate((node) => node.scrollTop);
      const clipSaved = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/bookmarks/'));
      await drag(page, { x: start.x, y: start.y - 12 }, { x: end.x, y: end.y + 12 });
      const clip = (await clipSaved).postDataJSON();
      assert.equal(clip.pageIndex, 0);
      const clipBytes = Buffer.from(clip.imageBase64, 'base64');
      await sharp(clipBytes).png().toFile(resolve(output, `${mode}-clip.png`));
      assert.equal(await scrollArea.evaluate((node) => node.scrollTop), initialScroll, `${mode} keeps the selection in place during a clip gesture`);
      const captureGuide = await findGuide(clipBytes);
      assert.ok(Math.abs(captureGuide.angle) < 0.3, `${mode} captured line angle is ${captureGuide.angle}°`);
      assert.ok(clip.rect.x <= from.x + 2 && clip.rect.y <= from.y && clip.rect.y + clip.rect.height >= to.y, `${mode} clip bounds contain both source endpoints`);
      const overlay = page.getByTestId('bookmark-page-overlay');
      await overlay.waitFor();
      const rotation = await overlay.evaluate((node) => {
        const m = new DOMMatrix(getComputedStyle(node).transform);
        return Math.atan2(m.b, m.a) * 180 / Math.PI;
      });
      assert.ok(Math.abs(rotation + sourceAngle) < 0.2, `${mode} bookmark uses page rotation`);
      await page.screenshot({ path: resolve(output, `${mode}-clip-overlay.png`) });
      result.clip = { angle: captureGuide.angle, rotation, rect: clip.rect };
    }
    assert.deepEqual(errors, []);
    return result;
  } finally {
    await context.close();
  }
}

async function checkUnavailable(browser, missingApi) {
  const context = await browser.newContext({ locale: 'ko-KR' });
  try {
    await context.addInitScript((noGpu) => {
      localStorage.setItem('pdfit.language', 'ko');
      if (noGpu) Object.defineProperty(navigator, 'gpu', { value: undefined });
      else navigator.gpu.requestAdapter = async () => null;
    }, missingApi);
    const page = await context.newPage();
    const errors = [];
    let pdfRequests = 0;
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(`${origin}/api/**`, (route) => {
      const path = new URL(route.request().url()).pathname;
      if (/\/(?:files|by-id)\//.test(path)) pdfRequests += 1;
      return route.fulfill({ json: /\/api\/(bookmarks|annotations|tags)/.test(path) ? [] : {} });
    });
    await page.goto(`${viewerUrl}&engine=legacy`);
    await page.getByRole('alert').filter({ hasText: 'PDF 뷰어에는 WebGPU가 필요합니다.' }).waitFor();
    assert.equal(await page.getByTestId('pdf-scroll-area').count(), 0);
    assert.equal(await page.getByTestId('pdfgpu-scroll-area').isVisible(), false);
    assert.equal(pdfRequests, 0);
    assert.deepEqual(errors, []);
    const mode = missingApi ? 'no-webgpu-api' : 'no-webgpu-adapter';
    await page.screenshot({ path: resolve(output, `${mode}.png`) });
    return { mode, pdfRequests, errors };
  } finally {
    await context.close();
  }
}

await mkdir(output, { recursive: true });
const health = await fetch(`${origin}/health`);
assert.equal(health.status, 200);
const browser = await chromium.launch({ channel: process.env.PDFIT_TEST_CHANNEL ?? 'chrome' });
const results = [];
try {
  for (const scenario of [checkViewer, (browser) => checkUnavailable(browser, true), (browser) => checkUnavailable(browser, false)]) {
    const result = await scenario(browser);
    results.push(result);
    process.stdout.write(`PASS ${result.mode}\n`);
  }
} finally {
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ origin, health: health.status, browser: browser.version(), results }, null, 2));
  await browser.close();
}
