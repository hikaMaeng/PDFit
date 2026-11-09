import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15201';
const engine = process.env.PDFIT_TEST_ENGINE === 'gpu' ? 'gpu' : 'legacy';
const output = new URL('./reports/viewer-layout-scroll/20260929_000000/', import.meta.url);
await mkdir(output, { recursive: true });

function createPdf(pageCount) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, index) => `${index + 3} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    ...Array.from({ length: pageCount }, () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>'),
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

const pdfBytes = createPdf(6);
let pdfFetches = 0;
const browser = await chromium.launch({ headless: true, args: engine === 'gpu' ? ['--enable-unsafe-webgpu', '--use-angle=swiftshader'] : [] });
const context = await browser.newContext({ locale: 'ko-KR', colorScheme: 'dark', viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => window.localStorage.setItem('pdfit.color-mode', 'dark'));
const page = await context.newPage();
const errors = [];
page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
page.on('pageerror', (error) => errors.push(`page: ${error.message}`));

const fulfillJson = (route, value) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
const viewerState = { page: 3, scale: 1.25, fitMode: 'none', viewMode: 'single', inverted: false, uiHidden: false, scrollTop: 0 };
await page.route(`${origin}/api/**`, async (route) => {
  const url = route.request().url();
  if (url.includes('/api/auth/me')) await fulfillJson(route, { authenticated: true, user: { id: 'viewer-layout-user', email: 'viewer@example.com', name: 'Viewer', picture: null }, subscription: { status: 'active', access: true } });
  else if (url.includes('/api/folders/cache')) await fulfillJson(route, { libraryInstanceId: 'viewer-layout-library', schemaVersion: '1', hydratedAt: new Date().toISOString(), snapshot: { system: [], folders: [{ driveFolderId: 'folder-1', parentFolderId: 'root', name: 'layout', color: '#3b82f6', isRoot: true, trashed: false }], pdfs: [{ driveFileId: 'file-1', parentFolderId: 'folder-1', name: 'six-pages.pdf', mimeType: 'application/pdf', size: pdfBytes.length, trashed: false }], tags: [], pdf_tags: [], bookmarks: [], reading_progress: [], viewer_state: [{ driveFileId: 'file-1', ...viewerState }], sync_state: [] } });
  else if (url.includes('/files/') || url.includes('/by-id/')) {
    if (route.request().method() === 'GET') pdfFetches += 1;
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ status: 200, contentType: 'application/pdf', body: pdfBytes });
  }
  else if (url.includes('/api/viewer-state/')) await fulfillJson(route, viewerState);
  else if (url.includes('/api/progress/')) await fulfillJson(route, { page: 3 });
  else if (url.includes('/api/bookmarks/') || url.includes('/api/annotations')) await fulfillJson(route, []);
  else if (url.includes('/api/settings/translations')) await fulfillJson(route, { translations: [] });
  else await fulfillJson(route, {});
});

const shellSelector = engine === 'gpu' ? '[data-testid="pdfgpu-page-shell"]' : '[data-legacy-page-shell="true"]';
const pageShell = (index) => page.locator(`${shellSelector}[data-page-index="${index}"]`);

try {
  const openedAt = Date.now();
  await page.goto(`${origin}/viewer/layout/six-pages.pdf?driveFileId=file-1&engine=${engine}`, { waitUntil: 'domcontentloaded' });
  const pageInput = page.getByLabel('페이지 번호');
  const singleButton = page.getByRole('button', { name: '한 페이지 보기' });
  const doubleButton = page.getByRole('button', { name: '두 페이지 보기' });
  const continuousButton = page.getByRole('button', { name: '연속 스크롤' });
  await page.getByTestId('viewer-load-progress-panel').waitFor({ state: 'visible', timeout: 10000 });
  await pageInput.waitFor({ state: 'visible', timeout: 30000 });
  try {
    await pageShell(2).waitFor({ state: 'visible', timeout: 30000 });
  } catch (error) {
    const rendererStatus = await page.getByRole('status', { name: 'viewer status' }).textContent().catch(() => null);
    throw new Error(`Requested ${engine} renderer did not expose page 3. status=${rendererStatus}; errors=${errors.join(' | ')}`, { cause: error });
  }
  const initialPageReadyMs = Date.now() - openedAt;
  assert.ok(initialPageReadyMs < 3000, `초기 문서 페이지 표시가 너무 느리다: ${initialPageReadyMs}ms`);
  assert.equal(await pageInput.inputValue(), '3');

  const annotationRail = await page.getByRole('complementary', { name: 'PDF 주석 도구' }).boundingBox();
  const initialViewport = await page.getByTestId('pdf-scroll-area').boundingBox();
  assert.ok(annotationRail && initialViewport && annotationRail.x + annotationRail.width <= initialViewport.x, '주석 도구 레일 폭은 PDF 뷰포트에 포함되면 안 된다.');

  const toolbarBox = await page.getByRole('toolbar', { name: 'viewer controls' }).boundingBox();
  const indicatorBox = await page.getByTestId('viewer-page-indicator').boundingBox();
  assert.ok(toolbarBox && indicatorBox && indicatorBox.x >= toolbarBox.x + toolbarBox.width / 2, '페이지 표시가 툴바 오른쪽에 있어야 한다.');

  await doubleButton.click();
  await pageShell(3).waitFor({ state: 'visible', timeout: 10000 });
  if (engine === 'legacy') {
    await pageShell(2).locator('canvas[data-render-source="pdf"]').waitFor({ state: 'visible' });
    await pageShell(3).locator('canvas[data-render-source="pdf"]').waitFor({ state: 'visible' });
  }
  assert.equal(await doubleButton.getAttribute('aria-pressed'), 'true');
  assert.equal(await continuousButton.getAttribute('aria-pressed'), 'false');
  const pagedViewport = await page.getByTestId('pdf-scroll-area').boundingBox();
  const pagedThird = await pageShell(2).boundingBox();
  const pagedFourth = await pageShell(3).boundingBox();
  assert.ok(pagedViewport && pagedThird && pagedFourth);
  assert.ok(pagedThird.x >= pagedViewport.x && pagedFourth.x + pagedFourth.width <= pagedViewport.x + pagedViewport.width + 1, '두 페이지가 뷰포트 가로폭 안에 함께 표시되어야 한다.');

  await continuousButton.click();
  await page.waitForFunction(() => document.querySelector('[aria-label="연속 스크롤"]')?.getAttribute('aria-pressed') === 'true');
  assert.equal(await doubleButton.getAttribute('aria-pressed'), 'true');
  assert.equal(await pageInput.inputValue(), '3');
  await page.waitForFunction(() => {
    const third = document.querySelector('[data-legacy-page-shell="true"][data-page-index="2"], [data-testid="pdfgpu-page-shell"][data-page-index="2"]');
    const fourth = document.querySelector('[data-legacy-page-shell="true"][data-page-index="3"], [data-testid="pdfgpu-page-shell"][data-page-index="3"]');
    return third && fourth && Math.abs(third.getBoundingClientRect().y - fourth.getBoundingClientRect().y) <= 1;
  });
  const scrollingThird = await pageShell(2).boundingBox();
  const scrollingFourth = await pageShell(3).boundingBox();
  assert.ok(scrollingThird && scrollingFourth && Math.abs(scrollingThird.y - scrollingFourth.y) <= 1, '연속 스크롤에서도 두 페이지가 같은 행에 있어야 한다.');
  if (engine === 'legacy') {
    await pageShell(2).locator('canvas[data-render-source="cache"]').waitFor({ state: 'visible', timeout: 5000 });
    await pageShell(3).locator('canvas[data-render-source="cache"]').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(pdfFetches, 1, '보기 모드 변경 시 PDF 파일을 다시 요청하면 안 된다.');
  }

  await page.getByRole('button', { name: '가로 너비 맞춤' }).click();
  const widthBeforeSidebar = (await pageShell(2).boundingBox())?.width ?? 0;
  await page.getByTestId(engine === 'gpu' ? 'bookmark-sidebar-toggle' : 'legacy-bookmark-sidebar-toggle').click();
  const sidebar = await page.getByRole('complementary', { name: '보관함' }).boundingBox();
  const viewportWithSidebar = await page.getByTestId('pdf-scroll-area').boundingBox();
  await page.waitForFunction((before) => {
    const shell = document.querySelector('[data-page-index="2"][data-legacy-page-shell="true"], [data-page-index="2"][data-testid="pdfgpu-page-shell"]');
    return shell instanceof HTMLElement && shell.getBoundingClientRect().width < before;
  }, widthBeforeSidebar);
  const widthAfterSidebar = (await pageShell(2).boundingBox())?.width ?? 0;
  assert.ok(sidebar && viewportWithSidebar && viewportWithSidebar.x >= sidebar.x + sidebar.width - 1, '뷰포트가 사이드바 오른쪽에서 시작해야 한다.');
  assert.ok(widthAfterSidebar < widthBeforeSidebar, '사이드바를 연 뒤 가로 맞춤 폭이 다시 계산되어야 한다.');
  await page.waitForFunction(() => (document.querySelector('[aria-label="페이지 번호"]'))?.value === '3');
  assert.equal(await pageInput.inputValue(), '3', '사이드바 폭 재계산 후에도 현재 페이지가 유지되어야 한다.');

  await page.screenshot({ path: new URL(`viewer-layout-scroll-${engine}.png`, output).pathname.slice(1), fullPage: true });
  assert.deepEqual(errors, []);
  const result = { engine, page: await pageInput.inputValue(), initialPageReadyMs, loadingGaugeVisible: true, doubleSelected: await doubleButton.getAttribute('aria-pressed'), continuousSelected: await continuousButton.getAttribute('aria-pressed'), widthBeforeSidebar, widthAfterSidebar, errors };
  await writeFile(new URL(`result-${engine}.json`, output), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ status: 'PASS', ...result }));
} finally {
  await context.close();
  await browser.close();
}
