import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { chromium } from 'playwright';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const staticDirectory = path.resolve(testDirectory, '..', 'dist');
const dockerOrigin = process.env.PDFIT_TEST_ORIGIN;
const reportDirectory = path.join(testDirectory, 'reports', 'dialog-copy-layout', '20261001_171500');
const app = express();
const files = Array.from({ length: 60 }, (_, index) => ({
  name: `테스트 문서 ${index + 1}.pdf`,
  driveFileId: `document-${index + 1}`,
  size: 1024,
  modifiedAt: '2026-10-01T00:00:00.000Z',
}));
const date = '2026-10-01T00:00:00.000Z';

app.get('/api/folders', (_request, response) => response.json([{ name: 'PDFit Library', pdfCount: files.length, createdAt: '', isRoot: true, color: '#3b82f6' }]));
app.get('/api/folders/:folder/files', (_request, response) => response.json(files));
app.get('/api/tags/summary', (_request, response) => response.json([{ name: '소프트웨어', bookCount: 66, color: '#16a34a' }]));
app.get('/api/tags/folder/:folder', (_request, response) => response.json({}));
app.get('/api/tags', (_request, response) => response.json(['소프트웨어']));
app.get('/api/*', (_request, response) => response.json([]));
app.use(express.static(staticDirectory));
app.get('*', (_request, response) => response.sendFile(path.join(staticDirectory, 'index.html')));

const server = dockerOrigin ? null : app.listen(0, '127.0.0.1');
if (server) await new Promise((resolve) => server.once('listening', resolve));
const address = server?.address();
if (!dockerOrigin && (!address || typeof address === 'string')) throw new Error('Test server did not expose a port.');
const origin = dockerOrigin ?? `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR' });
  await page.addInitScript(() => localStorage.setItem('pdfit.language', 'ko'));
  if (dockerOrigin) await page.route(`${dockerOrigin}/api/**`, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const data = pathname === '/api/auth/me'
      ? { authenticated: true, user: { id: 'layout-test', email: 'layout@example.com', name: 'Layout Test', picture: null }, subscription: { status: 'active', access: true, priceKrw: 12000, trialEndsAt: '2026-10-31T00:00:00.000Z', currentPeriodEndsAt: null, cancelAtPeriodEnd: false, nextBillingAt: null, trialDaysRemaining: 30, earlyPurchaseBonusDays: 0 } }
      : pathname === '/api/folders/cache'
        ? { libraryInstanceId: 'layout-test', schemaVersion: '1', hydratedAt: new Date().toISOString(), snapshot: {
          system: [],
          folders: [
            { driveFolderId: 'folder-1', parentFolderId: 'root', name: 'PDFit Library', color: '#3b82f6', isRoot: true, trashed: false, createdAt: date, updatedAt: date },
            { driveFolderId: 'folder-2', parentFolderId: 'root', name: '태그된 문서', color: '#3b82f6', isRoot: false, trashed: false, createdAt: date, updatedAt: date },
          ],
          pdfs: [...files.map((file) => ({ driveFileId: file.driveFileId, parentFolderId: 'folder-1', name: file.name, mimeType: 'application/pdf', size: file.size, md5Checksum: '', driveVersion: '1', createdTime: date, modifiedTime: date, trashed: false, updatedAt: date })), { driveFileId: 'tagged-document', parentFolderId: 'folder-2', name: '기존 태그 문서.pdf', mimeType: 'application/pdf', size: 1024, md5Checksum: '', driveVersion: '1', createdTime: date, modifiedTime: date, trashed: false, updatedAt: date }],
          tags: [{ tagId: 'tag-1', name: '소프트웨어', color: '#16a34a', createdAt: date, updatedAt: date, deletedAt: null }],
          pdf_tags: [{ relationId: 'relation-1', driveFileId: 'tagged-document', tagId: 'tag-1', createdAt: date, updatedAt: date, deletedAt: null }],
          bookmarks: [], reading_progress: [], viewer_state: [], sync_state: [],
        } }
        : pathname === '/api/folders' ? [{ name: 'PDFit Library', pdfCount: files.length, createdAt: '', isRoot: true, color: '#3b82f6' }]
          : pathname.endsWith('/files') ? files
            : pathname === '/api/tags/summary' ? [{ name: '소프트웨어', bookCount: 66, color: '#16a34a' }]
              : pathname.startsWith('/api/tags/folder/') ? {}
                : pathname === '/api/tags' ? ['소프트웨어']
                  : pathname === '/api/settings/translations' ? { translations: [] }
                    : [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.goto(`${origin}/folder/PDFit%20Library`, { waitUntil: dockerOrigin ? 'domcontentloaded' : 'networkidle' });
  await page.getByText('테스트 문서 1.pdf', { exact: true }).waitFor({ state: 'visible', timeout: 10000 }).catch(async (error) => {
    throw new Error(`Folder fixture did not render: ${page.url()} ${JSON.stringify((await page.locator('body').innerText()).slice(0, 700))}`, { cause: error });
  });

  await page.getByTestId('ai-auto-tag-all').click();
  const autoTagText = page.getByRole('dialog').getByText('이 폴더에서 태그가 없는 문서 60개를 자동 분류할까요?', { exact: true });
  await autoTagText.waitFor({ state: 'visible' });
  for (const width of [1280, 768]) {
    await page.setViewportSize({ width, height: 800 });
    const autoTagLayout = await autoTagText.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
      whiteSpace: getComputedStyle(element).whiteSpace,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    assert.equal(autoTagLayout.whiteSpace, 'nowrap');
    assert.ok(autoTagLayout.height <= autoTagLayout.lineHeight + 1 && autoTagLayout.scrollWidth <= autoTagLayout.clientWidth, `AI confirmation wrapped or overflowed at ${width}px: ${JSON.stringify(autoTagLayout)}`);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  if (dockerOrigin) {
    await mkdir(reportDirectory, { recursive: true });
    await page.getByRole('dialog').screenshot({ path: path.join(reportDirectory, 'ai-auto-tag-one-line.png') });
  }
  await page.getByRole('dialog').getByRole('button', { name: '취소' }).click();

  await page.getByRole('button', { name: '태그 전체 초기화' }).click();
  const resetText = page.getByRole('dialog').locator('.MuiDialogContent-root .MuiTypography-root').first();
  await resetText.waitFor({ state: 'visible' });
  const resetLayout = await resetText.evaluate((element) => ({
    text: element.textContent,
    height: element.getBoundingClientRect().height,
    lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
    whiteSpace: getComputedStyle(element).whiteSpace,
  }));
  assert.match(resetLayout.text ?? '', /초기화할까요\?\n문서와/);
  assert.equal(resetLayout.whiteSpace, 'pre-line');
  assert.ok(resetLayout.height >= resetLayout.lineHeight * 1.8 && resetLayout.height <= resetLayout.lineHeight * 2.2, `Tag reset message is not two lines: ${JSON.stringify(resetLayout)}`);
  if (dockerOrigin) await page.getByRole('dialog').screenshot({ path: path.join(reportDirectory, 'tag-reset-two-lines.png') });
  await page.getByRole('dialog').getByRole('button', { name: '취소' }).click();

  await page.getByRole('button', { name: '표지 보기' }).click();
  await page.getByTestId('pdf-cover-card').first().locator('button:has(svg[data-testid="DriveFileMoveIcon"])').click();
  const moveDialog = page.getByRole('dialog', { name: '다른 폴더로 이동' });
  const moveCopy = await moveDialog.locator('.MuiDialogContent-root').innerText();
  assert.match(moveCopy, /^문서를 이동할 폴더를 선택하세요\./);
  assert.doesNotMatch(moveCopy, /PDF를 이동할 폴더를 선택하세요/);
  if (dockerOrigin) await moveDialog.screenshot({ path: path.join(reportDirectory, 'move-document-copy.png') });
  console.log('PASS confirmation dialogs and move-document wording');
} finally {
  await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
}
