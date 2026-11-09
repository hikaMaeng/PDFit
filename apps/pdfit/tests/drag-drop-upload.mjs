import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { createPageNumberPdf } from './acceptance/lib/pdf-fixtures.mjs';

const baseUrl = process.env.PDFIT_TEST_BASE_URL ?? 'http://127.0.0.1:15201';
const folderName = `codex-drag-drop-${Date.now()}`;
const requestedFiles = [
  { name: 'drag-one.pdf', type: 'application/pdf', title: 'Drag One' },
  { name: 'drag-two.pdf', type: 'application/pdf', title: 'Drag Two' },
  { name: 'mac-preview-document', type: 'application/x-pdf', title: 'Mac Preview' },
];
const filenames = ['drag-one.pdf', 'drag-two.pdf', 'mac-preview-document.pdf'];
const browserName = process.env.PDFIT_TEST_BROWSER ?? 'chromium';
const browserType = browserName === 'webkit' ? webkit : chromium;
const browser = await browserType.launch({ headless: true });
const fixtureBrowser = browserName === 'chromium' ? browser : await chromium.launch({ headless: true });

try {
  const createResponse = await fetch(`${baseUrl}/api/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: folderName }),
  });
  assert.equal(createResponse.ok, true, `folder creation failed: ${createResponse.status}`);

  const pdfs = await Promise.all(requestedFiles.map((file, index) => createPageNumberPdf(fixtureBrowser, index + 1, file.title)));
  const context = await browser.newContext({ baseURL: baseUrl, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.route('**/api/events', (route) => route.abort());
  await page.goto(`/folder/${encodeURIComponent(folderName)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.getByText('PDF 파일이 없습니다.').waitFor({ state: 'visible' });

  const dataTransfer = await page.evaluateHandle(({ files, contents }) => {
    const transfer = new DataTransfer();
    contents.forEach((base64, index) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      transfer.items.add(new File([bytes], files[index].name, { type: files[index].type }));
    });
    return transfer;
  }, {
    files: requestedFiles,
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
  await page.getByText('PDF 3개', { exact: false }).waitFor({ state: 'visible' });
  assert.equal(await page.getByTestId('pdf-drop-overlay').count(), 0);
  await context.close();
  console.log(`drag-drop upload passed (${browserName}): ${filenames.join(', ')}`);
} finally {
  await fetch(`${baseUrl}/api/folders/${encodeURIComponent(folderName)}`, { method: 'DELETE' }).catch(() => undefined);
  if (fixtureBrowser !== browser) await fixtureBrowser.close();
  await browser.close();
}
