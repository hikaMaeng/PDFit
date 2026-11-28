import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { chromium } from 'playwright';
import { buildPdf } from '../../../packages/pdfit/tests/fixtures/pdfFixture.mjs';

const origin = process.env.PDFIT_TEXT_SELECTION_ORIGIN ?? 'http://127.0.0.1:15203';
const output = path.resolve(process.env.PDFIT_TEXT_SELECTION_OUTPUT ?? 'test/20261127/viewer-text-selection');
const folder = '__text-selection-browser__';
const nativePdf = 'Native.pdf';
const scannedPdf = 'Scanned.pdf';
const nativeLine = 'Native selectable text';
const scanLine = 'Select this scanned text';
const documents = new Map([[nativePdf, buildPdf({ labels: [nativeLine, 'Second page text'] })]]);

function buildScan() {
  const font = process.env.PDFIT_TEXT_SELECTION_FONT ?? 'C:/Windows/Fonts/malgun.ttf';
  assert.ok(GlobalFonts.registerFromPath(font, 'OCR fixture'));
  const canvas = createCanvas(1200, 1600);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#111';
  ctx.font = '48px "OCR fixture"';
  ctx.fillText(scanLine, 140, 335);
  ctx.fillText('한글 문서의 첫 번째 문장입니다.', 140, 420);
  ctx.fillText('이미지 위에서 문장을 선택합니다.', 140, 505);
  const jpeg = canvas.toBuffer('image/jpeg');
  const paint = 'q 600 0 0 800 0 0 cm /Scan Do Q\n';
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents 4 0 R /Resources << /XObject << /Scan 5 0 R >> >> >>'),
    Buffer.from(`<< /Length ${paint.length} >>\nstream\n${paint}endstream`),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1200 /Height 1600 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, Buffer.from('\nendstream')]),
  ];
  const chunks = [Buffer.from('%PDF-1.4\n')];
  const offsets = [];
  let position = chunks[0].length;
  for (const [index, object] of objects.entries()) {
    offsets.push(position);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]);
    chunks.push(chunk);
    position += chunk.length;
  }
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${position}\n%%EOF\n`));
  return Buffer.concat(chunks);
}
documents.set(scannedPdf, buildScan());

await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: 'chrome',
  args: process.env.PDFIT_TEXT_SELECTION_BROWSER_ARGS?.split(' ').filter(Boolean),
});
const result = { origin, browser: browser.version(), steps: [], errors: [], httpErrors: [], externalRequests: [], ocrAssets: [] };
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1240, height: 900 }, locale: 'ko-KR', permissions: ['clipboard-read', 'clipboard-write'] });
  await context.addInitScript(() => localStorage.setItem('pdfit.language', 'ko'));
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      result.externalRequests.push(url.href);
      return route.abort();
    }
    const prefix = `/api/folders/${folder}/files/`;
    if (url.pathname.startsWith(prefix)) {
      const body = documents.get(decodeURIComponent(url.pathname.slice(prefix.length)));
      if (body) {
        const headers = { 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
        const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? '');
        if (!range) return route.fulfill({ body, headers, contentType: 'application/pdf' });
        const start = Number(range[1]);
        const end = Math.min(range[2] ? Number(range[2]) : body.length - 1, body.length - 1);
        return route.fulfill({ status: 206, body: body.subarray(start, end + 1), contentType: 'application/pdf',
          headers: { ...headers, 'content-range': `bytes ${start}-${end}/${body.length}` } });
      }
    }
    if (url.pathname.startsWith(`/api/viewer-state/${folder}/`)) {
      return route.fulfill({ json: null });
    }
    if (url.pathname === '/api/folders/refresh' || url.pathname === `/api/folders/${folder}/files`) {
      return route.fulfill({ json: [] });
    }
    if (url.pathname === '/api/bookmarks' || url.pathname === '/api/annotations') {
      assert.equal(route.request().method(), 'GET');
      return route.fulfill({ json: [] });
    }
    if (/traineddata|tesseract-core|worker\.min-/.test(url.pathname) && !url.pathname.includes('pdf.worker')) {
      result.ocrAssets.push(url.pathname);
    }
    return route.continue();
  });

  page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      (result.consoleMessages ??= []).push(message.text().slice(0, 400));
    }
  });
  page.on('pageerror', (error) => result.errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) result.httpErrors.push({ status: response.status(), path: new URL(response.url()).pathname });
  });
  const open = (file) => page.goto(`${origin}/viewer/${folder}/${encodeURIComponent(file)}?page=1`);
  const selectable = (source) => page.getByTestId('pdf-selectable-page').and(page.locator(`[data-text-source="${source}"]`));
  const screenshot = (name) => page.screenshot({ path: path.join(output, `${name}.png`) });
  async function dragCopy(first, last, expected, startOffset = 1) {
    const [a, b] = await Promise.all([first.boundingBox(), last.boundingBox()]);
    assert.ok(a && b);
    await page.mouse.move(a.x + startOffset, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width - 1, b.y + b.height / 2, { steps: 12 });
    await page.mouse.up();
    const selection = await page.evaluate(() => window.getSelection().toString());
    assert.ok(selection.trim(), 'The pointer drag selects text');
    await page.evaluate(() => navigator.clipboard.writeText(''));
    await page.keyboard.press('Control+c');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(copied, expected);
    return a;
  }

  await open(nativePdf);
  await page.getByTestId('pdfgpu-scroll-area').waitFor();
  const nativeText = selectable('pdf').getByText(nativeLine, { exact: true });
  await nativeText.waitFor({ timeout: 12000 });
  const nativeBox = await dragCopy(nativeText, nativeText, nativeLine);
  await dragCopy(nativeText, nativeText, nativeLine, -5);
  assert.deepEqual(result.ocrAssets, []);
  await screenshot('native-selection');
  result.steps.push('Default native selection and copy with no OCR download');

  const pen = page.getByRole('button', { name: '자유 그리기', exact: true });
  await pen.click();
  assert.equal(await pen.getAttribute('aria-pressed'), 'true');
  await page.getByTestId('pdf-selectable-page').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.getSelection().toString()), '');
  await pen.click();
  assert.equal(await pen.getAttribute('aria-pressed'), 'false');
  await nativeText.waitFor({ timeout: 12000 });
  const copyRestored = await dragCopy(nativeText, nativeText, nativeLine);
  assert.equal(copyRestored.width, nativeBox.width);
  await page.getByRole('button', { name: '확대', exact: true }).click();
  const zoomBox = await dragCopy(nativeText, nativeText, nativeLine);
  assert.ok(zoomBox.width > nativeBox.width);
  result.steps.push('Left toolbar clears selection, then restores it. Selection follows zoom.');

  await page.getByRole('button', { name: '다음 페이지', exact: true }).click();
  const second = selectable('pdf').getByText('Second page text', { exact: true });
  await second.waitFor();
  await dragCopy(second, second, 'Second page text');
  assert.deepEqual(result.ocrAssets, []);

  await open(scannedPdf);
  const ocrPage = selectable('ocr');
  const first = ocrPage.getByText('Select', { exact: true });
  const last = ocrPage.getByText('text', { exact: true });
  await first.waitFor({ timeout: 30000 });
  await dragCopy(first, last, scanLine);
  await dragCopy(first, last, scanLine, -5);
  result.steps.push('A mouse drag starting five pixels before PDF or OCR text selects and copies the line.');
  await screenshot('scan-line-selection');
  const korean = ocrPage.getByText('한글', { exact: true });
  await dragCopy(first, korean, scanLine + '\n한글');
  await dragCopy(korean, korean, '한글');
  await screenshot('scan-korean-selection');
  assert.ok(result.ocrAssets.some((url) => url.includes('kor.traineddata')));
  assert.ok(result.ocrAssets.some((url) => url.includes('eng.traineddata')));
  assert.deepEqual(result.externalRequests, []);
  assert.deepEqual(result.errors, []);
  result.steps.push('Raster-only PDF with Korean and English. Copy keeps spaces and assets are same-origin.');
  const touch = await context.newCDPSession(page);
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await page.evaluate(() => window.getSelection().removeAllRanges());
  const target = await korean.boundingBox();
  assert.ok(target);
  await touch.send('Input.synthesizeTapGesture', {
    x: target.x + target.width / 2, y: target.y + target.height / 2, duration: 850, gestureSourceType: 'touch',
  });
  result.touchSelection = await page.evaluate(() => window.getSelection().toString());
  assert.equal(result.touchSelection, '한글');
  await screenshot('scan-touch-selection');
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await page.getByRole('button', { name: '텍스트 복사', exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '한글');
  result.steps.push('Chromium touch emulation long-press and copy');
  result.status = 'passed';
} catch (error) {
  result.status = 'failed';
  result.visibleText = await page?.locator('body').innerText().catch(() => '');
  result.layerSnapshot = await page?.locator('[data-pdf-document-text]').innerHTML({ timeout: 1000 }).catch(() => '');
  await page?.screenshot({ path: path.join(output, 'failure.png'), timeout: 5000 }).catch(() => {});
  result.failure = String(error.stack ?? error);
  throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
  await browser.close();
}
console.log(JSON.stringify(result));
