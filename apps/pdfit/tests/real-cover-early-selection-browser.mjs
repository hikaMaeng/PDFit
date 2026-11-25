import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rmdir } from 'node:fs/promises';
import { request as proxyRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { chromium } from 'playwright';
import { createCoverOverrideStore } from '../../../packages/pdfit/dist/server/covers/coverOverrideStore.js';
import { createCoversRouter } from '../../../packages/pdfit/dist/server/routes/covers.js';
import { createFilesystemService } from '../../../packages/pdfit/dist/server/services/filesystem.js';

const deployed = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const evidence = process.env.PDFIT_TEST_ARTIFACT_DIR;
const initialView = process.env.PDFIT_TEST_LIBRARY_VIEW === 'list' ? 'list' : 'covers';
const title = 'Early Cover';
const filename = `${title}.pdf`;
const folder = 'Cover fixtures';
const tag = 'Cover-fixture';
const imageUrl = 'https://image.yes24.com/goods/1/XL';
const png = Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'), Buffer.alloc(1024)]);
const dir = await mkdtemp(join(tmpdir(), 'pdfit-early-cover-'));
const store = createCoverOverrideStore(dir);
const browser = await chromium.launch({ headless: true, channel: process.env.PDFIT_TEST_CHANNEL ?? 'chrome' });
const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
page.setDefaultTimeout(5000);
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
const shot = async (name) => {
  if (!evidence) return;
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, `${name}.png`), animations: 'disabled' });
};

const pendingStarts = [];
const pendingAborts = [];
let sourceUnavailable = false;
const firstApply = Promise.withResolvers();
let puts = 0;

// Serve the deployed UI, with the real covers router using isolated storage and controlled sources.
const app = express();
app.use('/api/covers', express.json(), createCoversRouter({
  filesystem: createFilesystemService(dir, folder),
  store,
  hasFile: async (targetFolder, targetFile) => {
    const attempt = ++puts;
    if (attempt === 1) {
      await firstApply.promise;
      return false;
    }
    return targetFolder === folder && targetFile === filename;
  },
  request: async (url, { signal }) => {
    const host = new URL(url).hostname;
    if (String(url) === imageUrl) return new Response(png, { headers: { 'Content-Type': 'image/png' } });
    if (host === 'www.yes24.com') return new Response(`<img data-original="${imageUrl}" alt="${title}">`);
    assert.equal(host, 'openlibrary.org');
    if (sourceUnavailable) return new Response(null, { status: 503 });
    pendingStarts.push(performance.now());
    return new Promise((_, reject) => {
      signal.addEventListener('abort', () => {
        pendingAborts.push({ at: performance.now(), reason: signal.reason.name });
        reject(signal.reason);
      }, { once: true });
    });
  },
}));
app.get('/api/folders/cache', (_req, res) => res.status(404).json({}));
app.get('/api/tag-folders', (_req, res) => res.json([]));
app.get('/api/tags/summary', (_req, res) => res.json([{ name: tag, bookCount: 1 }]));
app.get(`/api/tags/${tag}/books`, (_req, res) => res.json([{ folder, filename, size: 1024, modified_at: '2026-11-23T00:00:00Z', tags: [tag] }]));
app.get('/api/tags/book/:folder/:file', (_req, res) => res.json([tag]));
app.get('/api/folders/:folder/files/:file/thumbnail', (_req, res) => res.type('png').send(png));
app.use((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.sendStatus(405);
    return;
  }
  const incoming = proxyRequest(new URL(req.originalUrl, deployed), { method: req.method }, (reply) => {
    res.writeHead(reply.statusCode, reply.headers);
    reply.pipe(res);
  });
  res.on('close', () => incoming.destroy());
  incoming.on('error', () => { if (!res.destroyed) res.destroy(); });
  req.pipe(incoming);
});
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
console.log(`Testing ${origin}/tag/${tag} with UI from ${deployed}.`);
const lookup = (request) => new URL(request.url()).searchParams.get('source') === 'Open Library';
const apply = (response) => new URL(response.url()).pathname === '/api/covers' && response.request().method() === 'PUT';
const dialog = page.getByRole('dialog', { name: 'Use a real book cover' });
const candidate = dialog.getByRole('button', { name: `Use cover: ${title} (YES24)` });
const searching = dialog.getByText('Searching covers…', { exact: true });
const openCover = page.getByTestId('pdf-cover-real-cover');

try {
  await page.addInitScript((view) => localStorage.setItem('pdfit.library.view', view), initialView);
  await page.goto(`${origin}/tag/${tag}`, { waitUntil: 'domcontentloaded' });
  await openCover.click();
  await candidate.waitFor();
  await candidate.locator('img').evaluate((image) => image.decode());
  await searching.waitFor();
  assert.equal(pendingStarts.length, 1);
  assert.equal(await candidate.isEnabled(), true);
  await shot('partial-results');

  const abortedBySelection = page.waitForEvent('requestfailed', lookup);
  const firstResponse = page.waitForResponse(apply);
  const clicked = performance.now();
  await candidate.click();
  await searching.waitFor({ state: 'hidden' });
  await dialog.getByText('Applying cover…', { exact: true }).waitFor();
  const canceled = await abortedBySelection;
  assert.match(canceled.failure().errorText, /ERR_ABORTED/);
  assert.equal(await candidate.isDisabled(), true);
  assert.equal(await dialog.getByRole('button', { name: 'Search covers' }).isDisabled(), true);
  await shot('applying-after-cancel');
  firstApply.resolve();
  assert.equal((await firstResponse).status(), 404);
  await dialog.getByRole('alert').filter({ hasText: 'File not found.' }).waitFor();
  assert.equal(await dialog.getByText('Could not reach: Open Library', { exact: true }).count(), 0);
  assert.equal(await candidate.isEnabled(), true);

  const [retried] = await Promise.all([page.waitForResponse(apply), candidate.click()]);
  assert.equal(retried.status(), 200);
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(puts, 2);
  assert.equal(pendingStarts.length, 1, 'retry applies the retained candidate without looking it up again');

  await openCover.click();
  await candidate.waitFor();
  await searching.waitFor();
  const [applied, abortedByApply] = await Promise.all([
    page.waitForResponse(apply),
    page.waitForEvent('requestfailed', lookup),
    candidate.click(),
  ]);
  assert.equal(applied.status(), 200);
  assert.match(abortedByApply.failure().errorText, /ERR_ABORTED/);
  const record = await applied.json();
  assert.equal(record.title, title);
  await dialog.waitFor({ state: 'hidden' });
  const appliedImage = page.getByTestId('pdf-cover-thumbnail').locator(`img[src*="c=${record.version}"]`);
  await appliedImage.waitFor();
  assert.equal((await store.get(folder, filename)).imageUrl, imageUrl);
  assert.equal(puts, 3);
  await shot('cover-applied');
  await page.locator(`button[value="${initialView === 'list' ? 'covers' : 'list'}"]`).click();
  await appliedImage.waitFor();
  await appliedImage.evaluate((image) => image.decode());
  await shot('cover-applied-other-view');
  await page.locator(`button[value="${initialView}"]`).click();

  await openCover.click();
  await candidate.waitFor();
  await searching.waitFor();
  const abortedByClose = page.waitForEvent('requestfailed', lookup);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  assert.match((await abortedByClose).failure().errorText, /ERR_ABORTED/);
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(pendingAborts.map(({ reason }) => reason), ['AbortError', 'AbortError', 'AbortError']);
  assert.ok(pendingAborts[0].at >= clicked);
  console.log(`Browser and server canceled Open Library on selection and on close. The first selection canceled in ${Math.round(pendingAborts[0].at - clicked)} ms and returned 404. Retry returned 200. Selecting during a new search also returned 200 and updated the card to version ${record.version}.`);

  sourceUnavailable = true;
  await openCover.click();
  await dialog.getByRole('alert').filter({ hasText: 'Could not reach: Open Library' }).waitFor();
  await candidate.waitFor();
  assert.equal(await candidate.isEnabled(), true);
  assert.equal(await searching.count(), 0);
  assert.deepEqual(pageErrors, []);
  console.log('Reopened search reported the genuine upstream 503, with the YES24 candidate available and no page errors.');
} catch (error) {
  await shot('failure');
  throw error;
} finally {
  firstApply.resolve();
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await store.remove(folder, filename);
  await rmdir(dir);
}
