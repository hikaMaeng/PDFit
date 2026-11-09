import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.PDFIT_TEST_BASE_URL ?? 'http://127.0.0.1:15201';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const started = Date.now();
const requests = [];
const pending = new Map();
page.on('request', (request) => {
  if (!request.url().includes('/api/')) return;
  pending.set(request, Date.now());
});
page.on('response', (response) => {
  const request = response.request();
  const begin = pending.get(request);
  if (begin == null) return;
  const path = new URL(request.url()).pathname;
  requests.push({ path: path.replace(/\/by-id\/[^/]+/, '/by-id/[id]'), status: response.status(), ms: Date.now() - begin, atMs: Date.now() - started });
  pending.delete(request);
});

try {
  const signIn = await context.request.post(`${baseUrl}/api/auth/local-preview`, { headers: { Origin: baseUrl } });
  assert.equal(signIn.status(), 200, 'local preview sign-in must succeed');
  const bootstrapResponse = await context.request.get(`${baseUrl}/api/folders/cache`);
  assert.equal(bootstrapResponse.status(), 200);
  const bootstrap = await bootstrapResponse.json();
  const folders = new Map(bootstrap.snapshot.folders.filter((row) => !row.trashed).map((row) => [row.driveFolderId, row.name]));
  const target = bootstrap.snapshot.pdfs
    .filter((row) => !row.trashed && folders.has(row.parentFolderId) && row.size > 1_000_000 && row.size < 20_000_000)
    .sort((left, right) => left.size - right.size)[0];
  assert.ok(target, 'a small indexed document must exist');
  const viewerUrl = `${baseUrl}/viewer/${encodeURIComponent(folders.get(target.parentFolderId))}/${encodeURIComponent(target.name)}?driveFileId=${encodeURIComponent(target.driveFileId)}`;
  const navigationStarted = Date.now();
  await page.goto(viewerUrl, { waitUntil: 'domcontentloaded' });
  const panel = page.getByTestId('viewer-load-progress-panel');
  await panel.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined);
  const gaugeAtMs = Date.now() - navigationStarted;
  const canvasReady = page.locator('canvas').first().waitFor({ state: 'visible', timeout: 60_000 }).then(() => ({ outcome: 'canvas', atMs: Date.now() - navigationStarted }));
  const alertReady = page.getByRole('alert').first().waitFor({ state: 'visible', timeout: 60_000 }).then(() => ({ outcome: 'alert', atMs: Date.now() - navigationStarted }));
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  const status = page.getByRole('status', { name: 'viewer status' });
  const outcome = await Promise.race([canvasReady, alertReady]).catch(() => ({ outcome: 'timeout', atMs: Date.now() - navigationStarted }));
  console.log(JSON.stringify({ targetBytes: target.size, gaugeAtMs, totalMs: Date.now() - navigationStarted, outcome, status: await status.textContent().catch(() => null), alerts: await page.getByRole('alert').allTextContents(), requests: requests.slice(0, 35), pdfRequests: requests.filter((row) => row.path.includes('/by-id/')).length }, null, 2));
} finally {
  await browser.close();
}
