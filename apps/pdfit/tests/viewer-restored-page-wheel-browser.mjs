import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// 저장된 마지막 페이지로 복원한 직후 첫 마우스 휠이 복원 페이지를 기준으로 이동하는지 검증한다.
const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const runId = process.env.PDFIT_TEST_RUN ?? '20261110_restored-wheel';
const output = new URL(`./reports/viewer-restored-page-wheel/${runId}/`, import.meta.url);
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

const pdfBytes = createPdf(8);
const fulfillJson = (route, value) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
const browser = await chromium.launch({ headless: true, ...(process.env.PDFIT_TEST_CHANNEL ? { channel: process.env.PDFIT_TEST_CHANNEL } : {}) });
const results = [];

try {
  // [저장 보기 모드, 복원 페이지, 휠 1회 뒤 기대 페이지]
  for (const [viewMode, savedPage, expectedAfterWheel] of [['single', 5, 6], ['double', 5, 7]]) {
    const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
    const viewerState = { page: savedPage, scale: 1, fitMode: 'none', viewMode, inverted: false, uiHidden: false, scrollTop: 0 };
    await page.route(`${origin}/api/**`, async (route) => {
      const url = route.request().url();
      if (url.includes('/files/') || url.includes('/by-id/')) await route.fulfill({ status: 200, contentType: 'application/pdf', body: pdfBytes });
      else if (url.includes('/api/viewer-state/')) await fulfillJson(route, route.request().method() === 'GET' ? viewerState : {});
      else if (url.includes('/api/progress/')) await fulfillJson(route, { page: savedPage });
      else if (url.includes('/api/bookmarks/') || url.includes('/api/annotations')) await fulfillJson(route, []);
      else if (url.includes('/api/settings/translations')) await fulfillJson(route, { translations: [] });
      else if (url.includes('/api/folders/cache')) await fulfillJson(route, { libraryInstanceId: 'restored-wheel-library', schemaVersion: '1', hydratedAt: new Date().toISOString(), snapshot: { system: [], folders: [{ driveFolderId: 'folder-1', parentFolderId: 'root', name: 'wheel', color: '#3b82f6', isRoot: true, trashed: false }], pdfs: [{ driveFileId: 'file-1', parentFolderId: 'folder-1', name: 'eight-pages.pdf', mimeType: 'application/pdf', size: pdfBytes.length, trashed: false }], tags: [], pdf_tags: [], bookmarks: [], reading_progress: [], viewer_state: [{ driveFileId: 'file-1', ...viewerState }], sync_state: [] } });
      else await route.continue();
    });

    try {
      await page.goto(`${origin}/viewer/wheel/eight-pages.pdf?driveFileId=file-1`, { waitUntil: 'domcontentloaded' });
      const pageInput = page.getByLabel('페이지 번호');
      await pageInput.waitFor({ state: 'visible', timeout: 30000 });
      await page.waitForFunction((expected) => document.querySelector('[aria-label="페이지 번호"]')?.value === String(expected), savedPage, { timeout: 15000 });
      const viewport = page.getByTestId('pdf-scroll-area');
      await viewport.waitFor({ state: 'visible' });
      await page.waitForTimeout(500); // 복원 직후 비동기 렌더/스프레드가 끝나도록 잠시 대기
      const restored = await pageInput.inputValue();
      assert.equal(restored, String(savedPage), `${viewMode}: 복원된 페이지`);

      const box = await viewport.boundingBox();
      assert.ok(box);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      // 이전/다음 버튼은 한 번도 누르지 않고 휠만 사용한다.
      await page.mouse.wheel(0, 120);
      await page.waitForFunction((expected) => document.querySelector('[aria-label="페이지 번호"]')?.value === String(expected), expectedAfterWheel, { timeout: 5000 }).catch(() => undefined);
      const afterWheel = await pageInput.inputValue();
      assert.equal(afterWheel, String(expectedAfterWheel), `${viewMode}: 복원 직후 첫 휠은 ${savedPage}페이지 기준으로 이동해야 한다 (실제 ${afterWheel})`);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: new URL(`${viewMode}.png`, output).pathname.slice(1) });
      results.push({ viewMode, savedPage, restored, afterWheel, expectedAfterWheel });
    } finally {
      await context.close();
    }
  }
  await writeFile(new URL('result.json', output), JSON.stringify({ status: 'PASS', results }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', results }));
} finally {
  await browser.close();
}
