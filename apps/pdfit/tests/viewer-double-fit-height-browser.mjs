import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15201';
const engine = process.argv.includes('--gpu') ? 'gpu' : 'legacy';
const pageHeight = process.argv.includes('--short-page') ? 400 : 792;
const largeTablet = process.argv.includes('--large-tablet');
const tabletInitialDouble = process.argv.includes('--initial-double') || largeTablet;
const desktopInitialDouble = process.argv.includes('--desktop-initial-double');
const touchSwipe = process.argv.includes('--touch-swipe');
const horizontalSwipe = process.argv.includes('--horizontal-swipe');
const naturalSwipe = process.argv.includes('--natural-swipe') || horizontalSwipe;
const initialDouble = tabletInitialDouble || desktopInitialDouble;
// Next two-page row after page 1. Both viewers start from the reader's pairing preference,
// which defaults to (1,2),(3,4) in a fresh browser, so the next row starts at page 3.
// (With @pdfgpu/core 0.1.10 the GPU viewer was cover-alone only and this was 2.)
const nextSpreadPage = '3';
const savedState = naturalSwipe ? { page: 1, scale: 0.56, fitMode: 'none', viewMode: 'double', inverted: false, uiHidden: false, scrollTop: 0 }
  : initialDouble ? { page: 1, scale: 1, fitMode: 'none', viewMode: 'double', inverted: false, uiHidden: false, scrollTop: 0 } : null;

function createPdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: touchSwipe || naturalSwipe ? 5 : 2 }, (_, index) => `${index + 3} 0 R`).join(' ')}] /Count ${touchSwipe || naturalSwipe ? 5 : 2} >>`,
    ...Array.from({ length: touchSwipe || naturalSwipe ? 5 : 2 }, () => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 ${pageHeight}] /Resources << >> >>`),
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

const pdfBytes = createPdf();
const browser = await chromium.launch({ headless: true, ...(process.env.PDFIT_TEST_CHANNEL ? { channel: process.env.PDFIT_TEST_CHANNEL } : {}), args: engine === 'gpu' ? ['--enable-unsafe-webgpu', '--use-angle=swiftshader'] : [] });
const context = await browser.newContext({ locale: 'ko-KR', viewport: largeTablet ? { width: 1024, height: 1366 } : tabletInitialDouble || touchSwipe || naturalSwipe ? { width: 768, height: 1024 } : { width: 1280, height: 800 }, hasTouch: tabletInitialDouble || touchSwipe || naturalSwipe });
const page = await context.newPage();
const fulfillJson = (route, value) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
const waitForZoom = async (zoom, predicate) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const current = await zoom.inputValue();
    if (predicate(current)) return current;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for zoom; last value was ${await zoom.inputValue()}`);
};

if (engine === 'gpu') {
  await page.route(`${origin}/viewer/**`, async (route) => {
    const response = await route.fetch();
    const headers = response.headers();
    headers['content-security-policy'] = headers['content-security-policy']?.replace("script-src 'self'", "script-src 'self' 'wasm-unsafe-eval'") ?? '';
    await route.fulfill({ response, headers });
  });
}
await page.route(`${origin}/api/**`, async (route) => {
  const url = route.request().url();
  if (url.includes('/api/auth/me')) await fulfillJson(route, { authenticated: true, user: { id: 'fit-user', email: 'fit@example.com', name: 'Fit', picture: null }, subscription: { status: 'active', access: true } });
  else if (url.includes('/api/folders/cache')) await fulfillJson(route, { libraryInstanceId: 'fit-library', schemaVersion: '1', hydratedAt: new Date().toISOString(), snapshot: { system: [], folders: [{ driveFolderId: 'folder-1', parentFolderId: 'root', name: 'fit', color: '#3b82f6', isRoot: true, trashed: false }], pdfs: [{ driveFileId: 'file-1', parentFolderId: 'folder-1', name: 'two-pages.pdf', mimeType: 'application/pdf', size: pdfBytes.length, trashed: false }], tags: [], pdf_tags: [], bookmarks: [], reading_progress: [], viewer_state: savedState ? [{ driveFileId: 'file-1', ...savedState }] : [], sync_state: [] } });
  else if (url.includes('/api/folders/by-id/')) await route.fulfill({ status: 200, headers: { 'content-type': 'application/pdf', 'content-length': String(pdfBytes.length), 'accept-ranges': 'bytes' }, body: route.request().method() === 'HEAD' ? undefined : pdfBytes });
  else if (url.includes('/api/viewer-state/')) await fulfillJson(route, savedState);
  else if (url.includes('/api/progress/')) await fulfillJson(route, { page: 1 });
  else if (url.includes('/api/bookmarks/') || url.includes('/api/annotations')) await fulfillJson(route, []);
  else if (url.includes('/api/settings/translations')) await fulfillJson(route, { translations: [] });
  else await fulfillJson(route, {});
});

try {
  await page.goto(`${origin}/viewer/fit/two-pages.pdf?driveFileId=file-1&engine=${engine}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  const zoom = page.getByLabel('확대/축소 비율');
  await zoom.waitFor({ state: 'visible', timeout: 30_000 });
  const viewport = page.getByTestId(engine === 'gpu' ? 'pdfgpu-scroll-area' : 'pdf-scroll-area');
  await viewport.waitFor({ state: 'visible', timeout: 30_000 });
  if (naturalSwipe) {
    const pageNumber = page.getByRole('textbox', { name: '페이지 번호' });
    const surface = page.getByTestId(engine === 'gpu' ? 'bookmark-capture-surface' : 'legacy-bookmark-capture-surface');
    const bounds = await surface.boundingBox();
    assert.ok(bounds);
    const metrics = await viewport.evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, scrollTop: element.scrollTop }));
    const x = bounds.x + bounds.width / 2;
    const cdp = await context.newCDPSession(page);
    const swipe = async (fromX, fromY, toX, toY) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y: fromY }] });
      for (let step = 1; step <= 8; step++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: fromX + (toX - fromX) * step / 8, y: fromY + (toY - fromY) * step / 8 }] });
        await new Promise((resolve) => setTimeout(resolve, 12));
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await pageNumber.waitFor({ state: 'visible' });
    assert.equal(await pageNumber.inputValue(), '1');
    if (horizontalSwipe) {
      await swipe(bounds.x + bounds.width * 0.75, bounds.y + bounds.height * 0.5, bounds.x + bounds.width * 0.25, bounds.y + bounds.height * 0.5);
    } else {
      await swipe(x, bounds.y + bounds.height * 0.75, x, bounds.y + bounds.height * 0.35);
    }
    await waitForZoom(pageNumber, (value) => value === nextSpreadPage);
    // A page turned while previews are still loading must stay turned once loading finishes
    // (the GPU viewer used to re-apply the saved page 1 on 'ready').
    await page.getByRole('progressbar').waitFor({ state: 'detached', timeout: 30_000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    assert.equal(await pageNumber.inputValue(), nextSpreadPage, 'the turned page must not snap back to the saved page');
    if (horizontalSwipe) {
      await swipe(bounds.x + bounds.width * 0.25, bounds.y + bounds.height * 0.5, bounds.x + bounds.width * 0.75, bounds.y + bounds.height * 0.5);
      await waitForZoom(pageNumber, (value) => value === '1');
      await zoom.fill('300');
      await zoom.press('Enter');
      await waitForZoom(zoom, (value) => value === '300');
      const horizontalRoom = await viewport.evaluate((element) => {
        const room = element.scrollWidth - element.clientWidth;
        element.scrollLeft = room / 2;
        return room;
      });
      assert.ok(horizontalRoom > 20, 'the zoomed spread should have room for horizontal panning');
      await swipe(bounds.x + bounds.width * 0.75, bounds.y + bounds.height * 0.5, bounds.x + bounds.width * 0.25, bounds.y + bounds.height * 0.5);
      assert.equal(await pageNumber.inputValue(), '1', 'a zoomed page should pan before turning');
    }
    console.log(JSON.stringify({ engine, naturalSwipe: true, horizontalSwipe, metrics, pageAfterSwipe: await pageNumber.inputValue() }));
  } else if (touchSwipe) {
    const pageNumber = page.getByRole('textbox', { name: '페이지 번호' });
    await page.getByRole('button', { name: '한 페이지 보기' }).click();
    const continuousButton = page.getByRole('button', { name: '연속 스크롤' });
    if (await continuousButton.getAttribute('aria-pressed') === 'true') await continuousButton.click();
    await page.getByRole('button', { name: '세로 높이 맞춤' }).click();
    await pageNumber.waitFor({ state: 'visible' });
    const surface = page.getByTestId(engine === 'gpu' ? 'bookmark-capture-surface' : 'legacy-bookmark-capture-surface');
    assert.equal(await surface.evaluate((element) => getComputedStyle(element).touchAction), 'none', 'fitted page should reserve touch gestures for page navigation');
    const bounds = await surface.boundingBox();
    assert.ok(bounds);
    const x = bounds.x + bounds.width / 2;
    const fromY = bounds.y + bounds.height * 0.75;
    const toY = bounds.y + bounds.height * 0.35;
    const cdp = await context.newCDPSession(page);
    const swipe = async (from, to) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: from }] });
      for (let step = 1; step <= 8; step++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: from + (to - from) * step / 8 }] });
        await new Promise((resolve) => setTimeout(resolve, 12));
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    assert.equal(await pageNumber.inputValue(), '1');
    await swipe(fromY, toY);
    await waitForZoom(pageNumber, (value) => value === '2');
    await swipe(toY, fromY);
    await waitForZoom(pageNumber, (value) => value === '1');
    await page.getByRole('button', { name: '두 페이지 보기' }).click();
    await page.getByRole('button', { name: '세로 높이 맞춤' }).click();
    await swipe(fromY, toY);
    await waitForZoom(pageNumber, (value) => value === nextSpreadPage);
    await continuousButton.click();
    assert.equal(await surface.evaluate((element) => getComputedStyle(element).touchAction), 'auto', 'continuous scrolling should keep native touch panning');
    console.log(JSON.stringify({ engine, touchSwipe, singleForwardAndBack: true, spreadPageAfterForward: await pageNumber.inputValue() }));
  } else if (initialDouble) {
    const doubleButton = page.getByRole('button', { name: '두 페이지 보기' });
    assert.equal(await doubleButton.getAttribute('aria-pressed'), 'true', 'saved double-page mode must be restored');
    await viewport.locator('[data-legacy-page-shell], [data-testid="pdfgpu-page-shell"]').nth(1).waitFor({ state: 'visible', timeout: 30_000 });
    if (tabletInitialDouble) await waitForZoom(zoom, (value) => value !== '100');
    const result = await viewport.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const shells = [...element.querySelectorAll('[data-legacy-page-shell], [data-testid="pdfgpu-page-shell"]')].slice(0, 2);
      return { viewport: { width: bounds.width, height: bounds.height }, scrollWidth: element.scrollWidth, pages: shells.map((shell) => ({ width: shell.getBoundingClientRect().width, height: shell.getBoundingClientRect().height })) };
    });
    if (tabletInitialDouble) {
      assert.ok(result.scrollWidth <= result.viewport.width + 2, 'restored spread must fit the tablet viewport width');
      assert.ok(result.pages.every((pdfPage) => pdfPage.height <= result.viewport.height + 2), 'restored spread pages must fit the tablet viewport height');
    } else assert.equal(await zoom.inputValue(), '100', 'desktop must keep its saved 100% zoom');
    console.log(JSON.stringify({ engine, tabletInitialDouble, desktopInitialDouble, pageHeight, zoom: await zoom.inputValue(), ...result }, null, 2));
  } else {
  await page.getByRole('button', { name: '두 페이지 보기' }).click();
  await zoom.fill('150');
  await zoom.press('Enter');
  await waitForZoom(zoom, (value) => value === '150');
  await page.getByRole('button', { name: '가로 너비 맞춤' }).click();
  const widthFitZoom = Number(await waitForZoom(zoom, (value) => value !== '150'));
  assert.ok(widthFitZoom < 150, 'width fit must replace a manual 150% zoom');
  await zoom.fill('150');
  await zoom.press('Enter');
  await waitForZoom(zoom, (value) => value === '150');
  await page.getByRole('button', { name: '세로 높이 맞춤' }).click();
  await waitForZoom(zoom, (value) => value !== '150');
  const result = await viewport.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const shells = [...element.querySelectorAll('[data-legacy-page-shell], [data-testid="pdfgpu-page-shell"]')].slice(0, 2);
    return { viewport: { width: bounds.width, height: bounds.height }, scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight, pages: shells.map((shell) => ({ width: shell.getBoundingClientRect().width, height: shell.getBoundingClientRect().height })) };
  });
  const fittedZoom = Number(await zoom.inputValue());
  assert.ok(Number.isFinite(fittedZoom) && fittedZoom > 0 && fittedZoom < 150, 'height fit must replace a manual 150% zoom');
  assert.ok(result.scrollWidth <= result.viewport.width + 2, 'two-page height fit must keep the spread within the viewport width');
  assert.ok(result.pages.every((pdfPage) => pdfPage.height <= result.viewport.height + 2), 'two-page height fit must keep each page within the viewport height');
  console.log(JSON.stringify({ engine, pageHeight, widthFitZoom, fittedZoom, ...result }, null, 2));
  }
} finally {
  await context.close();
  await browser.close();
}
