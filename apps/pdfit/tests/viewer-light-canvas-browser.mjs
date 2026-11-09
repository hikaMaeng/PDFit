import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';

const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15201';
const engine = process.argv.includes('--gpu') ? 'gpu' : 'legacy';
const browserName = process.argv.includes('--webkit') ? 'webkit' : 'chromium';
const output = 'apps/pdfit/tests/reports/viewer-light-canvas/20261002';
await mkdir(output, { recursive: true });

function createPdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>',
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
const browser = await (browserName === 'webkit' ? webkit : chromium).launch({
  headless: true,
  args: engine === 'gpu' && browserName === 'chromium' ? ['--enable-unsafe-webgpu', '--use-angle=swiftshader'] : [],
});

try {
  for (const mode of ['light', 'dark']) {
    const context = await browser.newContext({ locale: 'ko-KR', colorScheme: mode, viewport: { width: 1280, height: 800 } });
    await context.addInitScript((value) => window.localStorage.setItem('pdfit.color-mode', value), mode);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    if (engine === 'gpu') {
      await page.route(`${origin}/viewer/**`, async (route) => {
        const response = await route.fetch();
        const headers = response.headers();
        headers['content-security-policy'] = headers['content-security-policy']?.replace("script-src 'self'", "script-src 'self' 'wasm-unsafe-eval'") ?? '';
        await route.fulfill({ response, headers });
      });
    }
    const fulfillJson = (route, value) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
    await context.route(`${origin}/api/**`, async (route) => {
      const url = route.request().url();
      if (url.includes('/api/auth/me')) await fulfillJson(route, { authenticated: true, user: { id: 'viewer-color-user', email: 'viewer@example.com', name: 'Viewer', picture: null }, subscription: { status: 'active', access: true } });
      else if (url.includes('/api/folders/cache')) await fulfillJson(route, { libraryInstanceId: 'viewer-color-library', schemaVersion: '1', hydratedAt: new Date().toISOString(), snapshot: { system: [], folders: [{ driveFolderId: 'folder-1', parentFolderId: 'root', name: 'colors', color: '#3b82f6', isRoot: true, trashed: false }], pdfs: [{ driveFileId: 'file-1', parentFolderId: 'folder-1', name: 'two-pages.pdf', mimeType: 'application/pdf', size: pdfBytes.length, trashed: false }], tags: [], pdf_tags: [], bookmarks: [], reading_progress: [], viewer_state: [], sync_state: [] } });
      else if (url.includes('/api/folders/by-id/')) await route.fulfill({ status: 200, headers: { 'content-type': 'application/pdf', 'content-length': String(pdfBytes.length), 'accept-ranges': 'bytes' }, body: route.request().method() === 'HEAD' ? undefined : pdfBytes });
      else if (url.includes('/api/viewer-state/')) await fulfillJson(route, null);
      else if (url.includes('/api/progress/')) await fulfillJson(route, { page: 1 });
      else if (url.includes('/api/bookmarks/') || url.includes('/api/annotations')) await fulfillJson(route, []);
      else if (url.includes('/api/settings/translations')) await fulfillJson(route, { translations: [] });
      else await fulfillJson(route, {});
    });

    try {
      await page.goto(`${origin}/viewer/colors/two-pages.pdf?driveFileId=file-1&engine=${engine}`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      const viewport = page.getByTestId(engine === 'gpu' ? 'pdfgpu-scroll-area' : 'pdf-scroll-area');
      await viewport.waitFor({ state: 'visible', timeout: 30_000 });
      const expected = mode === 'light' ? 'rgb(232, 222, 205)' : 'rgb(58, 58, 58)';
      const canvasColor = async () => viewport.evaluate((element) => getComputedStyle(element).backgroundColor);
      const toolbar = page.getByRole('toolbar', { name: 'viewer controls' });
      const toolbarColor = async () => toolbar.evaluate((element) => getComputedStyle(element).backgroundColor);
      assert.equal(await canvasColor(), expected, `${engine} ${mode} canvas must use theme color`);
      assert.equal(await toolbarColor(), mode === 'light' ? 'rgb(245, 239, 228)' : 'rgb(32, 33, 36)');

      for (const buttonName of ['두 페이지 보기', '연속 스크롤']) {
        await page.getByRole('button', { name: buttonName }).click();
        assert.equal(await canvasColor(), expected, `${engine} ${mode} canvas changed after ${buttonName}`);
      }

      await page.getByTestId(engine === 'gpu' ? 'bookmark-sidebar-toggle' : 'legacy-bookmark-sidebar-toggle').click();
      const bookmarkPanel = page.getByRole('complementary', { name: '클립' });
      await bookmarkPanel.waitFor({ state: 'visible' });
      const bookmarkColor = await bookmarkPanel.evaluate((element) => getComputedStyle(element).backgroundColor);
      assert.equal(bookmarkColor, mode === 'light' ? 'rgb(245, 239, 228)' : 'rgb(36, 36, 38)');
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `${output}/${browserName}-${engine}-${mode}.png`, fullPage: true });
      if (mode === 'light') {
        const sourcePage = await context.newPage();
        await sourcePage.goto(origin, { waitUntil: 'domcontentloaded' });
        for (const [nextMode, nextColor] of [['dark', 'rgb(58, 58, 58)'], ['light', expected]]) {
          await sourcePage.evaluate((value) => localStorage.setItem('pdfit.color-mode', value), nextMode);
          const deadline = Date.now() + 5_000;
          while (await canvasColor() !== nextColor && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
          assert.equal(await canvasColor(), nextColor, `an already open ${engine} viewer must sync ${nextMode} from another tab`);
          assert.equal(await toolbarColor(), nextMode === 'light' ? 'rgb(245, 239, 228)' : 'rgb(32, 33, 36)');
        }
        await sourcePage.close();
      }
      console.log(JSON.stringify({ browser: browserName, engine, mode, canvasColor: await canvasColor(), bookmarkColor }));
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
