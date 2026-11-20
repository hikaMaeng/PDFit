import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createPageNumberPdf } from './acceptance/lib/pdf-fixtures.mjs';

const folder = 'Toolbar fixture';
const filename = 'Toolbar.pdf';
const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15213';
const viewerPath = `/viewer/${encodeURIComponent(folder)}/${filename}`;
const filePath = `/api/folders/${encodeURIComponent(folder)}/files/${filename}`;
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader'] });

try {
  const fixtureRoot = process.env.PDFIT_TOOLBAR_FIXTURE_ROOT;
  if (fixtureRoot) {
    const fixtureFolder = join(fixtureRoot, folder);
    await mkdir(fixtureFolder, { recursive: true });
    await writeFile(join(fixtureFolder, filename), await createPageNumberPdf(browser, 3, 'Toolbar fixture'), { flag: 'wx' });
  } else {
    await verifyToolbar();
  }
} finally {
  await browser.close();
}

async function verifyToolbar() {
  const runId = process.env.PDFIT_TEST_RUN ?? new Date().toISOString().replaceAll(/\D/g, '').slice(0, 14);
  const output = new URL(`../../../test/${runId.slice(0, 8)}/${runId.slice(8)}_viewer-toolbar-labels/`, import.meta.url);
  await mkdir(output, { recursive: true });
  const pdf = await fetch(`${origin}${filePath}`);
  assert.equal(pdf.status, 200, 'fixture available in the mounted library');
  const pdfBytes = Buffer.from(await pdf.arrayBuffer());
  assert.equal(pdfBytes.subarray(0, 5).toString(), '%PDF-');
  const results = [];

  for (const engine of ['legacy', 'gpu']) {
    const context = await browser.newContext({ locale: 'ko-KR', colorScheme: 'dark', acceptDownloads: true, viewport: { width: 1440, height: 900 } });
    try {
      await context.addInitScript(() => {
        localStorage.setItem('pdfit.language', 'ko');
        localStorage.setItem('pdfit.color-mode', 'dark');
        Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${origin}${viewerPath}?engine=${engine}&page=1`);
      const toolbar = page.getByRole('toolbar', { name: 'viewer controls' });
      await toolbar.getByTestId('viewer-page-indicator').getByText('/ 3', { exact: true }).waitFor();
      await page.getByTestId('viewer-load-progress-panel').waitFor({ state: 'hidden' });
      const gpuStatus = page.getByRole('status', { name: 'viewer status' });
      let backend = 'pdfjs';
      if (engine === 'gpu') {
        await gpuStatus.waitFor({ state: 'attached' });
        backend = (await gpuStatus.textContent()).split(' · ')[0].replace('Backend: ', '');
      }
      const title = page.locator('header').filter({ hasText: filename });
      const ocr = toolbar.getByRole('button', { name: '페이지 텍스트 읽기' });
      const download = toolbar.getByRole('button', { name: '문서 다운로드' });
      await title.waitFor();
      assert.equal(await title.getByTestId('page-ocr-open').count(), 0);
      assert.equal(await title.getByTestId('document-export-open').count(), 0);
      await download.getByText('Download', { exact: true }).waitFor();
      await ocr.getByText('OCR', { exact: true }).waitFor();

      const sizes = [];
      for (const width of [1440, 375]) {
        await page.setViewportSize({ width, height: 900 });
        const layout = await toolbar.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const buttons = [...element.querySelectorAll('button')];
          const rows = new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top)));
          const captions = buttons.map((button) => {
            const caption = button.querySelector('[lang="en"]');
            const icon = button.querySelector('svg');
            const bounds = button.getBoundingClientRect();
            return {
              text: caption?.textContent,
              fontSize: caption && getComputedStyle(caption).fontSize,
              inside: bounds.left >= rect.left && bounds.right <= rect.right,
              underIcon: caption && icon && caption.getBoundingClientRect().top >= icon.getBoundingClientRect().bottom,
            };
          });
          return { rows: rows.size, height: rect.height, overflow: element.scrollWidth - element.clientWidth, captions };
        });
        assert.equal(layout.overflow, 0);
        assert.equal(layout.rows, width === 1440 ? 1 : 3, `${width}px toolbar rows`);
        assert.deepEqual(layout.captions.map(({ text }) => text), ['1 Page', '2 Pages', 'Scroll', 'Fit Width', 'Fit Height', 'Zoom −', 'Zoom +', 'Image', 'Clips', 'OCR', 'Download', 'Contents', 'Prev', 'Next']);
        assert.ok(layout.captions.every(({ fontSize, inside, underIcon }) => fontSize === '10px' && inside && underIcon));
        await page.screenshot({ path: fileURLToPath(new URL(`${engine}-${width}.png`, output)) });
        sizes.push({ width, rows: layout.rows, height: layout.height });
      }

      const single = toolbar.getByRole('button', { name: '한 페이지 보기' });
      const double = toolbar.getByRole('button', { name: '두 페이지 보기' });
      await double.click();
      assert.equal(await double.getAttribute('aria-pressed'), 'true');
      await toolbar.getByTestId('spread-cover-alone').getByText('Cover', { exact: true }).waitFor();
      await single.click();
      assert.equal(await single.getAttribute('aria-pressed'), 'true');
      const zoom = toolbar.getByRole('textbox', { name: '확대/축소 비율' });
      await zoom.fill('137');
      await zoom.press('Enter');
      assert.equal(await zoom.inputValue(), '137');
      const pageNumber = toolbar.getByRole('textbox', { name: '페이지 번호' });
      await pageNumber.fill('2');
      await pageNumber.press('Enter');
      const recognition = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/ocr/page');
      await ocr.click();
      const recognized = await recognition;
      assert.equal(recognized.request().postDataJSON().pageIndex, 1);
      assert.equal(recognized.status(), 200);
      const ocrDialog = page.getByRole('dialog', { name: '2페이지 텍스트' });
      const ocrText = ocrDialog.getByTestId('page-ocr-text');
      await ocrText.waitFor();
      assert.equal((await ocrText.textContent()).trim(), 'Toolbar fixture Page 2 of 3');
      await ocrDialog.getByRole('button', { name: '닫기' }).click();

      await download.click();
      const downloadDialog = page.getByRole('dialog', { name: '문서 다운로드' });
      const downloading = page.waitForEvent('download');
      await downloadDialog.getByRole('button', { name: '다운로드', exact: true }).click();
      const saved = await downloading;
      assert.equal(saved.suggestedFilename(), filename);
      assert.deepEqual(await readFile(await saved.path()), pdfBytes);
      assert.deepEqual(errors, []);
      results.push({ engine, backend, sizes, recognizedPage: 2, downloadedBytes: pdfBytes.length, pageErrors: errors });
      console.log(`PASS ${engine} (${backend}): responsive captions, page 2 OCR, ${pdfBytes.length}-byte PDF`);
    } finally {
      await context.close();
    }
  }

  await writeFile(new URL('result.json', output), JSON.stringify({ origin, results }, null, 2));
}
