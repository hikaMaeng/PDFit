import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(here, '..', 'dist');
const evidenceDir = path.resolve(here, 'reports', 'document-auto-tagging', '20260916_000000');
await mkdir(evidenceDir, { recursive: true });

const tags = ['문학'];
let autoTagRequests = 0;
let manualTagRequests = 0;
const app = express();
app.use(express.json());
app.get('/api/folders', (_req, res) => res.json([{ name: '서재', pdfCount: 3, createdAt: '2026-09-10T00:00:00.000Z', isRoot: true, color: '#3b82f6' }]));
app.get('/api/folders/:folder/files', (_req, res) => res.json([
  { name: '데미안.pdf', size: 1024, modifiedAt: '2026-09-10T00:00:00.000Z' },
  { name: '분류 대기.pdf', size: 1024, modifiedAt: '2026-09-10T00:00:00.000Z' },
  { name: '업로드 중.pdf', size: 2048, modifiedAt: '2026-09-10T00:00:00.000Z', driveFileId: 'pending-upload-test' },
]));
app.get('/api/tags/summary', (_req, res) => res.json(tags.map((name) => ({ name, bookCount: 1, color: '#22c55e' }))));
app.get('/api/tags/folder/:folder', (_req, res) => res.json({ '데미안.pdf': [...tags] }));
app.get('/api/tags/book/:folder/:filename', (_req, res) => res.json([...tags]));
app.get('/api/tags', (_req, res) => res.json([...tags]));
app.post('/api/tags/book/:folder/:filename', (req, res) => {
  manualTagRequests += 1;
  setTimeout(() => {
    if (!tags.includes(req.body.tag)) tags.push(req.body.tag);
    res.json({ ok: true });
  }, 800);
});
app.delete('/api/tags/book/:folder/:filename/:tag', (req, res) => {
  setTimeout(() => {
    const index = tags.indexOf(req.params.tag);
    if (index >= 0) tags.splice(index, 1);
    res.json({ ok: true });
  }, 800);
});
app.post('/api/tags/book/:folder/:filename/auto', (_req, res) => {
  autoTagRequests += 1;
  const addedTags = ['고전'].filter((tag) => !tags.includes(tag));
  tags.push(...addedTags);
  res.json({ title: '데미안', suggestedTags: ['고전'], addedTags, removedTags: [] });
});
app.post('/api/tags/folder/:folder/auto', (req, res) => {
  autoTagRequests += 1;
  res.json({
    processed: req.body.books.length,
    failed: 0,
    addedTags: 0,
    books: req.body.books.map((book) => ({ filename: book.filename, addedTags: [], removedTags: [] })),
    errors: [],
  });
});
app.delete('/api/tags', (_req, res) => { tags.splice(0, tags.length); res.json({ ok: true }); });
app.get('/api/settings/ai-servers', (_req, res) => res.json([]));
app.use(express.static(staticDir));
app.get('*', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));

const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Browser fixture did not expose a port.');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ locale: 'ko-KR' });
  await page.addInitScript(() => localStorage.setItem('pdfit.language', 'ko'));
  await page.goto(`http://127.0.0.1:${address.port}/folder/${encodeURIComponent('서재')}`, { waitUntil: 'domcontentloaded' });
  await page.getByText('데미안.pdf', { exact: true }).waitFor({ state: 'visible' });
  await page.getByText('PDF 3', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(await page.getByTestId('tag-assignment-total').textContent(), '1');
  assert.equal(await page.getByRole('button', { name: '폴더 색상 변경' }).count(), 0);
  const [selectionBox, filenameBox] = await Promise.all([
    page.getByTestId('pdf-selection-checkbox').first().boundingBox(),
    page.getByText('데미안.pdf', { exact: true }).boundingBox(),
  ]);
  assert.ok(selectionBox && filenameBox && selectionBox.x < filenameBox.x, 'selection checkbox should be in the left column');
  await page.getByText('업로드 처리 중 · 완료 후 열기 가능').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '표지 보기' }).click();
  await page.getByTestId('pdf-cover-grid').waitFor({ state: 'visible' });
  assert.equal(await page.getByTestId('pdf-cover-card').count(), 3);
  await page.getByRole('button', { name: '목록 보기' }).click();
  await page.getByTestId('pdf-cover-grid').waitFor({ state: 'detached' });
  const inlineAutoButton = page.getByRole('button', { name: 'PDF 자동 분류' }).first();
  await inlineAutoButton.waitFor({ state: 'visible' });
  assert.equal(await inlineAutoButton.getAttribute('data-testid'), 'pdf-ai-auto-tag');
  await page.screenshot({ path: path.join(evidenceDir, 'ai-auto-tag-row.png'), fullPage: true });
  await page.getByRole('button', { name: '태그 관리' }).first().click();
  await page.getByRole('dialog').getByLabel('태그 추가').fill('사용자태그');
  const closeStartedAt = Date.now();
  await page.getByRole('dialog').getByRole('button', { name: '닫기' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.ok(Date.now() - closeStartedAt < 400, '태기는 서버 저장 응답을 기다리지 않아야 합니다.');
  await page.getByRole('button', { name: '사용자태그' }).waitFor({ state: 'visible' });
  assert.equal(manualTagRequests, 1);
  await page.getByText(/"사용자태그" 태그가 추가되었습니다/).waitFor({ state: 'visible' });
  assert.deepEqual(tags, ['문학', '사용자태그']);
  await page.getByRole('button', { name: '태그 관리' }).first().click();
  const autoButton = page.getByRole('dialog').getByRole('button', { name: 'PDF 자동 분류' });
  await autoButton.waitFor({ state: 'visible' });
  await autoButton.click();
  await page.getByRole('button', { name: '고전' }).waitFor({ state: 'visible' });
  await page.getByText(/분류 태그를 추가했습니다/).waitFor({ state: 'visible' });
  assert.deepEqual(tags, ['문학', '사용자태그', '고전']);
  const manualChip = page.getByRole('dialog').locator('.MuiChip-root').filter({ hasText: '사용자태그' });
  const deleteStartedAt = Date.now();
  await manualChip.locator('.MuiChip-deleteIcon').click();
  await manualChip.waitFor({ state: 'detached' });
  assert.ok(Date.now() - deleteStartedAt < 400, '태그 삭제는 서버 응답 전에 화면에 반영되어야 합니다.');
  await page.getByText(/"사용자태그" 태그가 삭제되었습니다/).waitFor({ state: 'visible' });
  assert.deepEqual(tags, ['문학', '고전']);
  await page.screenshot({ path: path.join(evidenceDir, 'ai-auto-tag-dialog.png'), fullPage: true });
  await page.getByRole('dialog').getByRole('button', { name: '닫기' }).click();
  await page.getByRole('button', { name: 'PDF 일괄 태그' }).click();
  const bulkDialog = page.getByRole('dialog');
  await bulkDialog.getByText('이 폴더에서 태그가 없는 문서 1개를 자동 분류할까요?').waitFor({ state: 'visible' });
  await bulkDialog.getByRole('button', { name: 'PDF 일괄 태그' }).click();
  await page.getByText(/책 1권을 모두 확인했습니다/).waitFor({ state: 'visible' });
  assert.equal(autoTagRequests, 2);
  await page.screenshot({ path: path.join(evidenceDir, 'ai-auto-tag-all.png'), fullPage: true });
  await page.getByRole('button', { name: '태그 전체 초기화' }).click();
  await page.getByText(/PDF와 북마크는 유지됩니다/).waitFor({ state: 'visible' });
  await page.getByRole('dialog').getByRole('button', { name: '삭제' }).click();
  await page.getByRole('button', { name: '태그 전체 초기화' }).waitFor({ state: 'detached' });
  assert.deepEqual(tags, []);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
