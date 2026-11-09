import assert from 'node:assert/strict';
import { once } from 'node:events';
import path from 'node:path';
import express from 'express';
import { chromium } from 'playwright';

function minimalPdf() {
  const parts = ['%PDF-1.4\n'];
  const offsets = [0];
  const object = (id, body) => { offsets[id] = Buffer.byteLength(parts.join('')); parts.push(`${id} 0 obj\n${body}\nendobj\n`); };
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Resources << >> /Contents 4 0 R >>');
  const stream = 'q\n0.15 0.45 0.9 rg\n0 0 200 300 re f\nQ\n';
  object(4, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
  const xref = Buffer.byteLength(parts.join(''));
  parts.push(`xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.from(parts.join(''));
}

const pdf = minimalPdf();
const files = Array.from({ length: 8 }, (_, index) => ({ name: `cover-${index + 1}.pdf`, size: pdf.length, modifiedAt: '2026-09-11T00:00:00.000Z', driveFileId: `cover-${index + 1}` }));
const thumbnail = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const thumbnailRequests = new Map();
const storedThumbnails = new Set();
let fileRequests = 0;
const app = express();
app.get('/api/folders', (_request, response) => response.json([{ name: 'Library', pdfCount: files.length, createdAt: '2026-09-11T00:00:00.000Z', isRoot: true, color: '#3b82f6' }]));
app.get('/api/folders/:folder/files', (_request, response) => response.json(files));
app.put('/api/folders/by-id/:id/thumbnail', express.raw({ type: 'image/jpeg', limit: '2mb' }), (request, response) => {
  assert.ok(Buffer.isBuffer(request.body) && request.body.length > 0, 'generated cover should be uploaded as JPEG bytes');
  storedThumbnails.add(request.params.id);
  response.status(204).end();
});
app.get('/api/folders/by-id/:id/thumbnail', async (request, response) => {
  const id = request.params.id;
  const count = (thumbnailRequests.get(id) ?? 0) + 1;
  thumbnailRequests.set(id, count);
  await new Promise((resolve) => setTimeout(resolve, id === 'cover-8' ? 180 : 35));
  if (id === 'cover-7' && !storedThumbnails.has(id)) { response.status(404).end(); return; }
  if (id === 'cover-8' && count === 1) { response.status(503).end(); return; }
  response.type('image/png').set('Cache-Control', 'private, max-age=86400').send(thumbnail);
});
app.get('/api/folders/by-id/:id', async (request, response) => {
  fileRequests += 1;
  if (request.params.id === 'cover-8') { response.status(503).end(); return; }
  await new Promise((resolve) => setTimeout(resolve, request.params.id === 'cover-7' ? 5_500 : 100));
  response.type('application/pdf').set('Content-Length', String(pdf.length)).set('Accept-Ranges', 'bytes').send(pdf);
});
app.get('/api/tags/summary', (_request, response) => response.json([]));
app.get('/api/tags/folder/:folder', (_request, response) => response.json({}));
app.use(express.static(path.resolve(import.meta.dirname, '..', 'dist')));
app.get('*', (_request, response) => response.sendFile(path.resolve(import.meta.dirname, '..', 'dist', 'index.html')));

const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const browser = await chromium.launch({ headless: true });
try {
  const { port } = server.address();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto(`http://127.0.0.1:${port}/folder/Library`, { waitUntil: 'domcontentloaded' });
  await page.getByText('cover-1.pdf', { exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: /Cover view|표지 보기/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="pdf-cover-thumbnail"] img').length === 6);
  const fallbackCard = page.getByTestId('pdf-cover-card').filter({ hasText: 'cover-7.pdf' });
  await fallbackCard.getByText(/Preparing cover|표지를 준비하는 중/).waitFor({ state: 'visible' });
  await fallbackCard.locator('canvas').waitFor({ state: 'visible' });
  for (let attempt = 0; attempt < 50 && !storedThumbnails.has('cover-7'); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(storedThumbnails.has('cover-7'), true, 'PDF fallback should persist a small Drive cover thumbnail');
  const failedCard = page.getByTestId('pdf-cover-card').filter({ hasText: 'cover-8.pdf' });
  const retry = failedCard.getByTestId('retry-cover');
  await retry.waitFor({ state: 'visible' });
  await failedCard.getByText(/Cover could not be displayed|표지를 표시하지 못했어요/).waitFor({ state: 'visible' });
  await failedCard.getByText(/The PDF can still be opened|PDF 파일은 정상적으로 열 수 있어요/).waitFor({ state: 'visible' });
  assert.equal(fileRequests > 0, true, 'failed Drive thumbnail should fall back to PDF rendering');
  await retry.click();
  await failedCard.locator('[data-testid="pdf-cover-thumbnail"] img').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-testid="pdf-cover-thumbnail"] img').count(), 7, 'provider covers should be visible while the generated fallback remains on canvas');
  const firstThumbnailRequests = [...thumbnailRequests.values()].reduce((sum, value) => sum + value, 0);
  const firstFileRequests = fileRequests;
  const generatedThumbnailRequests = thumbnailRequests.get('cover-7') ?? 0;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="pdf-cover-thumbnail"] img').length === 8);
  assert.ok((thumbnailRequests.get('cover-7') ?? 0) > generatedThumbnailRequests, 'second visit should retrieve the generated thumbnail instead of the PDF');
  assert.ok([...thumbnailRequests.values()].reduce((sum, value) => sum + value, 0) <= firstThumbnailRequests + files.length, 'second visit should request at most one small thumbnail per cover');
  assert.equal(fileRequests, firstFileRequests, 'cached Drive thumbnails should avoid PDF fallback downloads on later visits');
} finally {
  await browser.close();
  server.close();
  await once(server, 'close');
}
