import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { chromium, webkit } from 'playwright';

const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15201';
const engine = process.env.PDFIT_TEST_ENGINE === 'gpu' ? 'gpu' : 'legacy';
const preview = process.argv.includes('--preview');
const touchSaveHint = process.argv.includes('--touch-save-hint');
const browserType = process.argv.includes('--webkit') ? webkit : chromium;
const output = new URL('../tests/reports/viewer-toolbar-export/20260923_162000/', import.meta.url);
await mkdir(output, { recursive: true });

const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const downloadServer = createServer((request, response) => {
  if (request.url !== '/document.pdf?download=1') { response.writeHead(404).end(); return; }
  response.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent('인공지능 개론.pdf')}`,
    'Content-Length': String(pdfBytes.length),
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(pdfBytes);
});
downloadServer.listen(0, '127.0.0.1');
await once(downloadServer, 'listening');
const downloadFixtureUrl = `http://127.0.0.1:${downloadServer.address().port}/document.pdf?download=1`;
const browser = await browserType.launch({ headless: !preview });
const context = await browser.newContext({ locale: 'ko-KR', colorScheme: 'dark', acceptDownloads: true, viewport: touchSaveHint ? { width: 768, height: 1024 } : { width: 1440, height: 1000 }, hasTouch: touchSaveHint, ...(touchSaveHint ? { userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' } : {}) });
await context.addInitScript(() => window.localStorage.setItem('pdfit.color-mode', 'dark'));
const page = await context.newPage();
const errors = [];
page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
page.on('pageerror', (error) => errors.push(`page: ${error.message}`));

const fulfillJson = (route, value) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
await context.route(`${origin}/api/**`, async (route) => {
  const url = route.request().url();
  if (url.includes('/api/auth/me')) {
    await fulfillJson(route, { authenticated: true, user: { id: 'test-user', email: 'test@example.com', name: 'Test User', picture: null }, subscription: { status: 'active', access: true } });
  } else if (url.includes('/api/folders/cache')) {
    await fulfillJson(route, { libraryInstanceId: 'library-test', schemaVersion: '1', hydratedAt: new Date().toISOString(), snapshot: { system: [], folders: [{ driveFolderId: 'folder-1', parentFolderId: 'root', name: '연구', color: '#3b82f6', isRoot: true, trashed: false }], pdfs: [{ driveFileId: 'file-1', parentFolderId: 'folder-1', name: '인공지능 개론.pdf', mimeType: 'application/pdf', size: pdfBytes.length, trashed: false }], tags: [], pdf_tags: [], bookmarks: [], reading_progress: [], viewer_state: [{ driveFileId: 'file-1', page: 1, scale: 1.2, fitMode: 'none', viewMode: 'single', inverted: false, uiHidden: false, scrollTop: 0 }], sync_state: [] } });
  } else if (url.includes('/files/') || url.includes('/by-id/')) {
    const attachment = new URL(url).searchParams.get('download') === '1';
    await route.fulfill({ status: 200, contentType: attachment ? 'application/octet-stream' : 'application/pdf', headers: { 'Content-Disposition': `${attachment ? 'attachment' : 'inline'}; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent('인공지능 개론.pdf')}`, ...(attachment ? { 'X-Content-Type-Options': 'nosniff' } : {}) }, body: pdfBytes });
  } else if (url.includes('/api/viewer-state/')) {
    await fulfillJson(route, { page: 1, scale: 1.2, fitMode: 'none', viewMode: 'single', inverted: false, uiHidden: false, scrollTop: 0 });
  } else if (url.includes('/api/progress/')) {
    await fulfillJson(route, { page: 1 });
  } else if (url.includes('/api/bookmarks/') || url.includes('/api/annotations')) {
    await fulfillJson(route, []);
  } else if (url.includes('/api/settings/translations')) {
    await fulfillJson(route, { translations: ['연구'] });
  } else {
    await fulfillJson(route, {});
  }
});

try {
  const viewerUrl = `${origin}/viewer/%EC%97%B0%EA%B5%AC/%EC%9D%B8%EA%B3%B5%EC%A7%80%EB%8A%A5%20%EA%B0%9C%EB%A1%A0.pdf?driveFileId=file-1&engine=${engine}`;
  await page.goto(viewerUrl, { waitUntil: 'domcontentloaded' });
  const zoomInput = page.getByLabel('확대/축소 비율');
  await zoomInput.waitFor({ state: 'visible', timeout: 30000 });

  if (preview) {
    console.log('다크 테마 로컬 미리보기 브라우저가 열렸습니다. 확인을 마치면 브라우저 창을 닫아 주세요.');
    await new Promise((resolve) => browser.once('disconnected', resolve));
  } else if (touchSaveHint) {
    await page.evaluate(() => {
      Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
    });
    await page.getByTestId('document-export-open').click();
    await page.getByText('Safari에 설정된 다운로드 위치에 저장됩니다.', { exact: true }).waitFor({ state: 'visible' });
    const downloadButton = page.getByRole('button', { name: '다운로드', exact: true });
    const downloadHref = await downloadButton.getAttribute('href');
    const downloadName = await downloadButton.getAttribute('download');
    if (!downloadHref || new URL(downloadHref).searchParams.get('download') !== '1' || downloadName !== '인공지능 개론.pdf') throw new Error(`Direct download link contract failed: ${downloadHref}, ${downloadName}`);
    await downloadButton.evaluate((element, href) => element.setAttribute('href', href), downloadFixtureUrl);
    const downloadPromise = page.waitForEvent('download');
    await downloadButton.click();
    const download = await downloadPromise;
    if (!['document.pdf', '인공지능 개론.pdf'].includes(download.suggestedFilename())) throw new Error(`Touch download contract failed: filename=${download.suggestedFilename()}, href=${downloadHref}`);
    const downloadedBytes = await readFile(await download.path());
    if (!downloadedBytes.equals(pdfBytes)) throw new Error(`Touch download was incomplete: ${downloadedBytes.length} of ${pdfBytes.length} bytes`);
    await page.getByRole('heading', { name: '문서 다운로드' }).waitFor({ state: 'visible' });
    if (errors.length) throw new Error(errors.join(' | '));
    console.log(`PASS Safari default download location (${browserType.name()})`);
  } else {
  const pageInput = page.getByLabel('페이지 번호');
  const singleButton = page.getByRole('button', { name: '한 페이지 보기' });
  const doubleButton = page.getByRole('button', { name: '두 페이지 보기' });
  const continuousButton = page.getByRole('button', { name: '연속 스크롤' });
  const fitWidthButton = page.getByRole('button', { name: '가로 너비 맞춤' });
  const archiveButton = page.getByRole('button', { name: '보관함 열기' });
  const order = await Promise.all([singleButton, doubleButton, continuousButton, fitWidthButton, zoomInput, pageInput].map(async (locator) => (await locator.boundingBox())?.x ?? -1));
  if (!order.every((x, index) => index === 0 || x > order[index - 1])) throw new Error(`Toolbar order is incorrect: ${order.join(', ')}`);

  await zoomInput.fill('137');
  await zoomInput.press('Enter');
  if (await zoomInput.inputValue() !== '137') throw new Error('Manual zoom percentage was not applied.');

  if (await continuousButton.getAttribute('aria-pressed') !== 'false') throw new Error('Continuous scroll should start off.');
  await continuousButton.click();
  if (await continuousButton.getAttribute('aria-pressed') !== 'true') throw new Error('Continuous scroll did not turn on.');
  await continuousButton.click();
  if (await continuousButton.getAttribute('aria-pressed') !== 'false') throw new Error('Continuous scroll did not turn off.');

  await fitWidthButton.click();
  if (await fitWidthButton.getAttribute('aria-pressed') !== null) throw new Error('Fit width must be a momentary action.');

  await archiveButton.click();
  await page.getByRole('button', { name: '보관함 닫기' }).waitFor({ state: 'visible' });
  await page.getByRole('complementary', { name: '보관함' }).waitFor({ state: 'visible' });
  await page.getByText('보관함', { exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '보관함 닫기' }).click();
  await archiveButton.waitFor({ state: 'visible' });

  if (engine === 'gpu') {
    const selectMoveButton = page.getByRole('button', { name: 'select' });
    if (await selectMoveButton.locator('[data-testid="select-move-cursor-icon"]').count() !== 1) throw new Error('Select/move cursor icon is missing.');
    await selectMoveButton.hover();
    await page.getByText('선택·이동', { exact: true }).waitFor({ state: 'visible' });
  }

  await page.evaluate(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
  });
  await page.getByTestId('document-export-open').click();
  await page.getByRole('heading', { name: '문서 다운로드' }).waitFor({ state: 'visible' });
  await page.getByText('이 문서를 기기에 다운로드합니다.', { exact: true }).waitFor({ state: 'visible' });
  if (await page.getByRole('dialog').getByTestId('PictureAsPdfOutlinedIcon').count() !== 0) throw new Error('Download filename still has a PDF icon.');
  if (await page.getByText('원본 PDF', { exact: true }).count() !== 0) throw new Error('Original PDF option is still visible.');
  if (await page.getByText('Markdown 독서 노트', { exact: true }).count() !== 0) throw new Error('Markdown option is still visible.');
  if (await page.getByText('JSON 데이터', { exact: true }).count() !== 0) throw new Error('JSON option is still visible.');

  await page.screenshot({ path: new URL('viewer-toolbar-export.png', output).pathname.slice(1), fullPage: true });
  await page.getByRole('button', { name: '다운로드', exact: true }).evaluate((element, href) => element.setAttribute('href', href), downloadFixtureUrl);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '다운로드', exact: true }).click();
  const download = await downloadPromise;
  if (!['document.pdf', '인공지능 개론.pdf'].includes(download.suggestedFilename())) throw new Error(`Unexpected fixture download name: ${download.suggestedFilename()}`);
  if (!(await readFile(await download.path())).equals(pdfBytes)) throw new Error('Downloaded PDF bytes did not match the source.');
  await page.getByRole('button', { name: '취소' }).click();

  await page.evaluate(() => {
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async (options) => {
        window.__pdfitSavePicker = { suggestedName: options.suggestedName, writtenBytes: 0, closed: false };
        return { createWritable: async () => ({ write: async (blob) => { window.__pdfitSavePicker.writtenBytes = blob.size; }, close: async () => { window.__pdfitSavePicker.closed = true; } }) };
      },
    });
  });
  await page.getByTestId('document-export-open').click();
  await page.getByRole('button', { name: '다운로드', exact: true }).click();
  await page.getByRole('heading', { name: '문서 다운로드' }).waitFor({ state: 'hidden' });
  const picker = await page.evaluate(() => window.__pdfitSavePicker);
  if (picker?.suggestedName !== '인공지능 개론.pdf' || picker.writtenBytes !== pdfBytes.length || !picker.closed) throw new Error(`Native save picker contract failed: ${JSON.stringify(picker)}`);
  if (errors.length) throw new Error(errors.join(' | '));

  await writeFile(new URL('result.json', output), JSON.stringify({ toolbarOrder: order, manualZoom: 137, continuousToggle: true, fitWidthMomentary: true, archiveToggleLabel: true, archiveSidebarTitle: true, cursorTool: true, exportOptions: ['pdf'], download: download.suggestedFilename(), nativeSavePicker: picker, errors }, null, 2));
  console.log('PASS viewer toolbar and PDF export browser test');
  }
} finally {
  if (browser.isConnected()) await browser.close();
  downloadServer.close();
  await once(downloadServer, 'close');
}
