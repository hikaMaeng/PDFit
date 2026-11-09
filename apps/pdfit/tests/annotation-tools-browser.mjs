import { chromium } from 'playwright';

const baseUrl = process.env.PDFIT_TEST_BASE_URL ?? 'http://127.0.0.1:15201';
const engine = process.env.PDFIT_TEST_ENGINE === 'legacy' ? 'legacy' : 'gpu';
const fileText = process.env.PDFIT_TEST_FILE_TEXT;
const startPage = Math.max(1, Number.parseInt(process.env.PDFIT_TEST_START_PAGE ?? '1', 10) || 1);
const initialViewMode = process.env.PDFIT_TEST_VIEW_MODE === 'double' ? 'double' : 'single';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const createdIds = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => errors.push(`page: ${error.message}`));

const waitForCreate = () => page.waitForResponse(
  (response) => response.url().includes('/api/annotations') && response.request().method() === 'POST',
  { timeout: 5000 },
);

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.getByRole('link', { name: '라이브러리 열기' }).click();
  await page.waitForTimeout(3000);
  const viewerLink = fileText ? page.getByRole('link', { name: fileText, exact: true }) : page.locator('a[href*="/viewer/"]').first();
  const viewerUrl = await viewerLink.getAttribute('href');
  if (!viewerUrl) throw new Error('PDF viewer link not found');
  const targetUrl = new URL(viewerUrl, baseUrl);
  if (engine === 'legacy') targetUrl.searchParams.set('engine', 'legacy');
  if (startPage > 1) targetUrl.searchParams.set('page', String(startPage));
  await page.goto(targetUrl.href, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'highlight' }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(8000);

  const pageInput = page.getByLabel('page number');
  await pageInput.fill(String(startPage));
  await pageInput.press('Enter');
  await page.waitForTimeout(800);
  await page.locator(`button[value="${initialViewMode}"]`).click();
  await page.waitForTimeout(800);

  const layer = page.getByTestId('annotation-layer');
  const requestedPageIndex = startPage - 1;
  const primaryPageIndex = initialViewMode === 'double' && engine === 'gpu' && requestedPageIndex > 0
    ? requestedPageIndex % 2 === 1 ? requestedPageIndex : requestedPageIndex - 1
    : requestedPageIndex;
  const shell = page.locator(`[data-pdfgpu-page-shell="true"][data-page-index="${primaryPageIndex}"], [data-legacy-page-shell="true"][data-page-index="${primaryPageIndex}"]`).first();
  const [layerBox, shellBox] = await Promise.all([layer.boundingBox(), shell.boundingBox()]);
  if (!layerBox || !shellBox) throw new Error('Annotation layer or rendered PDF page not found');

  const results = [];
  const drawingTools = [
    { tool: 'highlight', testId: 'annotation-highlight', hint: '형광펜 활성화 · PDF 위에서 영역을 드래그하세요', start: [0.12, 0.16], end: [0.42, 0.21] },
    { tool: 'pen', testId: 'annotation-ink', hint: '자유 그리기 활성화 · PDF 위에서 드래그해 그리세요', start: [0.15, 0.28], end: [0.45, 0.34] },
    { tool: 'rectangle', testId: 'annotation-rectangle', hint: '사각형 활성화 · PDF 위에서 영역을 드래그하세요', start: [0.15, 0.40], end: [0.38, 0.49] },
    { tool: 'circle', testId: 'annotation-circle', hint: '원 활성화 · PDF 위에서 영역을 드래그하세요', start: [0.48, 0.40], end: [0.68, 0.51] },
    { tool: 'line', testId: 'annotation-line', hint: '선 활성화 · PDF 위에서 시작점부터 끝점까지 드래그하세요', start: [0.15, 0.58], end: [0.42, 0.64] },
    { tool: 'arrow', testId: 'annotation-arrow', hint: '화살표 활성화 · PDF 위에서 시작점부터 끝점까지 드래그하세요', start: [0.48, 0.58], end: [0.72, 0.66] },
  ];

  for (const spec of drawingTools) {
    const button = page.getByRole('button', { name: spec.tool });
    await button.click();
    const selected = await button.getAttribute('aria-pressed');
    const hint = await page.getByTestId('annotation-tool-hint').textContent();
    const cursor = await layer.evaluate((element) => getComputedStyle(element).cursor);
    const beforeCount = await page.getByTestId(spec.testId).count();
    const createResponsePromise = waitForCreate();
    const start = { x: shellBox.x + shellBox.width * spec.start[0], y: shellBox.y + shellBox.height * spec.start[1] };
    const end = { x: shellBox.x + shellBox.width * spec.end[0], y: shellBox.y + shellBox.height * spec.end[1] };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up();
    const response = await createResponsePromise;
    const created = await response.json();
    createdIds.push(created.id);
    await page.waitForTimeout(200);
    results.push({ tool: spec.tool, selected, hint, expectedHint: spec.hint, cursor, beforeCount, afterCount: await page.getByTestId(spec.testId).count(), status: response.status(), pageIndex: created.pageIndex, expectedPageIndex: primaryPageIndex });
  }

  const textButton = page.getByRole('button', { name: 'text' });
  await textButton.click();
  const textSelected = await textButton.getAttribute('aria-pressed');
  const textHint = await page.getByTestId('annotation-tool-hint').textContent();
  const textCursor = await layer.evaluate((element) => getComputedStyle(element).cursor);
  const textBeforeCount = await page.getByTestId('annotation-text').count();
  const textResponsePromise = waitForCreate();
  await page.mouse.click(shellBox.x + shellBox.width * 0.15, shellBox.y + shellBox.height * 0.75);
  const editor = page.getByLabel('annotation text editor');
  await editor.waitFor();
  await editor.fill('PDFit 텍스트 주석 브라우저 검증');
  await editor.press('Tab');
  const textResponse = await textResponsePromise;
  const createdText = await textResponse.json();
  createdIds.push(createdText.id);
  await page.waitForTimeout(200);
  results.splice(1, 0, { tool: 'text', selected: textSelected, hint: textHint, expectedHint: '텍스트 추가 활성화 · PDF 위에서 입력할 위치를 클릭하세요', cursor: textCursor, beforeCount: textBeforeCount, afterCount: await page.getByTestId('annotation-text').count(), status: textResponse.status(), pageIndex: createdText.pageIndex, expectedPageIndex: primaryPageIndex });

  if (initialViewMode === 'double') {
    const secondaryPageIndex = primaryPageIndex + 1;
    const rightShell = page.locator(`[data-pdfgpu-page-shell="true"][data-page-index="${secondaryPageIndex}"], [data-legacy-page-shell="true"][data-page-index="${secondaryPageIndex}"]`).first();
    const rightShellBox = await rightShell.boundingBox();
    if (!rightShellBox) throw new Error('Right PDF page not found in double-page mode');
    const highlightButton = page.getByRole('button', { name: 'highlight' });
    await highlightButton.click();
    const beforeCount = await page.getByTestId('annotation-highlight').count();
    const createResponsePromise = waitForCreate();
    await page.mouse.move(rightShellBox.x + rightShellBox.width * 0.15, rightShellBox.y + rightShellBox.height * 0.20);
    await page.mouse.down();
    await page.mouse.move(rightShellBox.x + rightShellBox.width * 0.45, rightShellBox.y + rightShellBox.height * 0.25, { steps: 10 });
    await page.mouse.up();
    const response = await createResponsePromise;
    const created = await response.json();
    createdIds.push(created.id);
    await page.waitForTimeout(200);
    results.push({ tool: 'highlight-right', selected: await highlightButton.getAttribute('aria-pressed'), hint: await page.getByTestId('annotation-tool-hint').textContent(), expectedHint: '형광펜 활성화 · PDF 위에서 영역을 드래그하세요', cursor: await layer.evaluate((element) => getComputedStyle(element).cursor), beforeCount, afterCount: await page.getByTestId('annotation-highlight').count(), status: response.status(), pageIndex: created.pageIndex, expectedPageIndex: secondaryPageIndex });
  }

  let pageIsolation = null;
  if (startPage === 1) {
    const scrollArea = page.getByTestId(engine === 'legacy' ? 'pdf-scroll-area' : 'pdfgpu-scroll-area');
    const highlightBoxBeforeScroll = await page.getByTestId('annotation-highlight').first().boundingBox();
    const scrollBefore = await scrollArea.evaluate((element) => element.scrollTop);
    await scrollArea.evaluate((element) => element.scrollBy(0, element.clientHeight * 1.1));
    await page.waitForTimeout(500);
    const scrollAfter = await scrollArea.evaluate((element) => element.scrollTop);
    const highlightBoxAfterScroll = await page.getByTestId('annotation-highlight').first().boundingBox();
    await scrollArea.evaluate((element) => element.scrollTo(0, 0));
    await page.waitForTimeout(500);
    pageIsolation = { scrollBefore, scrollAfter, highlightBoxBeforeScroll, highlightBoxAfterScroll };
  }

  const countCreatedAnnotations = async () => (await Promise.all(createdIds.map((id) => page.locator(`[data-annotation-id="${id}"]`).count()))).reduce((sum, count) => sum + count, 0);
  await pageInput.fill(String(startPage));
  await pageInput.press('Enter');
  await page.waitForTimeout(500);
  await page.locator('button[value="single"]').click();
  await page.waitForTimeout(500);
  const singleIsolationPage = startPage + (initialViewMode === 'double' ? 2 : 1);
  await pageInput.fill(String(singleIsolationPage));
  await pageInput.press('Enter');
  await page.waitForTimeout(500);
  const singlePageIsolation = { page: await pageInput.inputValue(), createdAnnotationCount: await countCreatedAnnotations() };
  await pageInput.fill(String(startPage));
  await pageInput.press('Enter');
  await page.waitForTimeout(500);
  await page.locator('button[value="double"]').click();
  await page.waitForTimeout(500);
  if (engine === 'legacy') {
    await pageInput.fill(String(startPage + 2));
    await pageInput.press('Enter');
  } else {
    await page.getByRole('button', { name: '다음 페이지' }).click();
  }
  await page.waitForTimeout(500);
  const doublePageIsolation = { page: await pageInput.inputValue(), createdAnnotationCount: await countCreatedAnnotations() };

  await page.screenshot({ path: `${process.env.TEMP ?? '.'}/pdfit-annotation-tools-browser.png`, fullPage: true });
  console.log(JSON.stringify({ engine, url: page.url(), layerBox, shellBox, results, pageIsolation, singlePageIsolation, doublePageIsolation, errors }, null, 2));

  for (const result of results) {
    const expectedCursor = result.tool === 'text' ? 'text' : 'crosshair';
    if (result.selected !== 'true' || result.hint !== result.expectedHint || result.cursor !== expectedCursor || result.afterCount !== result.beforeCount + 1 || result.status !== 201 || result.pageIndex !== result.expectedPageIndex) {
      throw new Error(`${result.tool} failed: ${JSON.stringify(result)}`);
    }
  }
  if (singlePageIsolation.page !== String(singleIsolationPage) || singlePageIsolation.createdAnnotationCount !== 0) throw new Error(`single-page isolation failed: ${JSON.stringify(singlePageIsolation)}`);
  if (doublePageIsolation.page !== String(startPage + 2) || doublePageIsolation.createdAnnotationCount !== 0) throw new Error(`double-page isolation failed: ${JSON.stringify(doublePageIsolation)}`);
  if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`);
} finally {
  for (const id of createdIds) {
    await page.request.delete(`${baseUrl}/api/annotations/${encodeURIComponent(id)}`);
  }
  await browser.close();
}
