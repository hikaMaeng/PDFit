import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createPageNumberPdf } from './acceptance/lib/pdf-fixtures.mjs';

const baseUrl = process.env.PDFIT_TEST_BASE_URL ?? 'http://127.0.0.1:15201';
const folderName = `codex-drag-drop-${Date.now()}`;
const filenames = ['drag-one.pdf', 'drag-two.pdf'];
const browser = await chromium.launch({ headless: true });

try {
  const createResponse = await fetch(`${baseUrl}/api/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: folderName }),
  });
  assert.equal(createResponse.ok, true, `folder creation failed: ${createResponse.status}`);

  const pdfs = await Promise.all([
    createPageNumberPdf(browser, 1, 'Drag One'),
    createPageNumberPdf(browser, 2, 'Drag Two'),
  ]);
  const context = await browser.newContext({ baseURL: baseUrl, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(`/folder/${encodeURIComponent(folderName)}`, { waitUntil: 'domcontentloaded' });
  await page.getByText('PDF 파일이 없습니다.').waitFor({ state: 'visible' });

  const dataTransfer = await page.evaluateHandle(({ names, contents }) => {
    const transfer = new DataTransfer();
    contents.forEach((base64, index) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      transfer.items.add(new File([bytes], names[index], { type: 'application/pdf' }));
    });
    return transfer;
  }, {
    names: filenames,
    contents: pdfs.map((pdf) => pdf.toString('base64')),
  });

  const dropZone = page.getByTestId('folder-drop-zone');
  await dropZone.dispatchEvent('dragenter', { dataTransfer });
  await page.getByTestId('pdf-drop-overlay').waitFor({ state: 'visible' });
  await dropZone.dispatchEvent('dragover', { dataTransfer });
  await dropZone.dispatchEvent('drop', { dataTransfer });
  await dataTransfer.dispose();

  for (const filename of filenames) {
    await page.getByText(filename, { exact: false }).first().waitFor({ state: 'visible', timeout: 30_000 });
  }
  await page.getByText('PDF 2개', { exact: false }).waitFor({ state: 'visible' });
  assert.equal(await page.getByTestId('pdf-drop-overlay').count(), 0);
  await context.close();
  console.log(`drag-drop upload passed: ${filenames.join(', ')}`);
} finally {
  await fetch(`${baseUrl}/api/folders/${encodeURIComponent(folderName)}`, { method: 'DELETE' }).catch(() => undefined);
  await browser.close();
}
