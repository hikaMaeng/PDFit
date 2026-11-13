/**
 * Large library must not block: the cover grid mounts in chunks from the top and the
 * thumbnails load a few at a time, in list order.
 *
 * Run: node apps/pdfit/tests/large-library-progressive-browser.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import express from 'express';
import { chromium } from 'playwright';

const TOTAL = 600;
const THUMBNAIL_DELAY_MS = 120;
const files = Array.from({ length: TOTAL }, (_, index) => ({
  name: `book-${String(index + 1).padStart(4, '0')}.pdf`,
  size: 1024 + index,
  modifiedAt: '2026-11-13T00:00:00.000Z',
}));
const thumbnail = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

/** Thumbnail traffic: every request with the moment it started and ended, in arrival order. */
const thumbnailLog = [];
let inFlight = 0;
let maxInFlight = 0;

const app = express();
app.get('/api/folders', (_request, response) => response.json([{ name: 'Library', pdfCount: files.length, createdAt: '2026-11-13T00:00:00.000Z', isRoot: true, color: '#3b82f6' }]));
app.get('/api/folders/:folder/files', (_request, response) => response.json(files));
app.get('/api/folders/:folder/files/:filename/thumbnail', async (request, response) => {
  inFlight += 1;
  maxInFlight = Math.max(maxInFlight, inFlight);
  const record = { filename: request.params.filename, startedAt: Date.now(), peak: inFlight };
  thumbnailLog.push(record);
  await new Promise((resolve) => setTimeout(resolve, THUMBNAIL_DELAY_MS));
  inFlight -= 1;
  record.finishedAt = Date.now();
  response.type('image/png').set('Cache-Control', 'private, max-age=86400').send(thumbnail);
});
app.get('/api/tags/summary', (_request, response) => response.json([]));
app.get('/api/tags/folder/:folder', (_request, response) => response.json({}));
app.get('/api/tags/untagged-count', (_request, response) => response.json({ count: 0 }));
app.get('/api/covers', (_request, response) => response.status(404).end());
app.use(express.static(path.resolve(import.meta.dirname, '..', 'dist')));
app.get('*', (_request, response) => response.sendFile(path.resolve(import.meta.dirname, '..', 'dist', 'index.html')));

const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
/** Playwright's bundled headless shell may not be installed; `PDFIT_TEST_CHROMIUM_PATH` or `PDFIT_TEST_CHANNEL=chrome` picks another build. */
const launch = { headless: true };
if (process.env.PDFIT_TEST_CHROMIUM_PATH) launch.executablePath = process.env.PDFIT_TEST_CHROMIUM_PATH;
else if (process.env.PDFIT_TEST_CHANNEL) launch.channel = process.env.PDFIT_TEST_CHANNEL;
const browser = await chromium.launch(launch);
try {
  const { port } = server.address();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.addInitScript(() => { window.localStorage.setItem('pdfit.library.view', 'covers'); });
  await page.goto(`http://127.0.0.1:${port}/folder/Library`, { waitUntil: 'domcontentloaded' });

  const sentinel = page.locator('[data-testid="list-mount-sentinel"]');
  await sentinel.waitFor({ state: 'attached', timeout: 20_000 });

  // 1. 첫 커밋에 전부 붙지 않는다: 화면을 채울 만큼만 먼저 그린다.
  const firstRendered = Number(await sentinel.getAttribute('data-list-rendered'));
  const total = Number(await sentinel.getAttribute('data-list-total'));
  assert.equal(total, TOTAL, 'the sentinel must report the whole filtered list');
  assert.ok(firstRendered > 0 && firstRendered <= TOTAL / 4, `the first commit must mount a chunk, not the library (was ${firstRendered} of ${TOTAL})`);

  // 2. 붙이는 동안에도 메인 스레드가 돈다: rAF 간격이 한 번도 400ms를 넘지 않아야 한다.
  await page.evaluate(() => {
    window.__frameGaps = [];
    let previous = performance.now();
    const tick = () => {
      const now = performance.now();
      window.__frameGaps.push(now - previous);
      previous = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // 3. 목록은 끝까지 차오른다.
  await page.waitForFunction(() => document.querySelector('[data-testid="list-mount-sentinel"]')?.dataset.listMounted === 'true', null, { timeout: 60_000 });
  const mountedCards = await page.locator('[data-testid="pdf-cover-thumbnail"]').count();
  assert.equal(mountedCards, TOTAL, 'every item must be mounted once the list finished growing');

  const worstFrameGap = await page.evaluate(() => Math.round(Math.max(...window.__frameGaps)));
  assert.ok(worstFrameGap < 400, `mounting must not freeze the page (worst frame gap ${worstFrameGap}ms)`);

  // 4. 화면 위쪽 표지가 먼저 뜬다.
  await page.waitForFunction(() => document.querySelectorAll('[data-cover-state="ready"]').length >= 6, null, { timeout: 30_000 });
  const firstReady = await page.evaluate(() => [...document.querySelectorAll('[data-cover-state="ready"]')].slice(0, 6).map((card) => card.getAttribute('aria-label')));
  for (const [index, label] of firstReady.entries()) {
    assert.ok(label?.startsWith(`book-${String(index + 1).padStart(4, '0')}.pdf`), `cover ${index + 1} on screen should be the ${index + 1}th file, was ${label}`);
  }

  // 5. 동시 요청은 여섯 개로 제한된다.
  assert.ok(thumbnailLog.length > 0, 'covers must be requested');
  assert.ok(maxInFlight <= 6, `thumbnail loads must stay within the queue limit (peak ${maxInFlight})`);

  // 6. 뷰포트 밖 표지를 미리 다 받지 않는다: 스크롤 전에는 일부만 요청된다.
  assert.ok(thumbnailLog.length < TOTAL, `only the covers in range may be requested before scrolling (requested ${thumbnailLog.length} of ${TOTAL})`);

  const requestedInOrder = thumbnailLog.slice(0, 6).map((record) => record.filename);
  const expectedOrder = files.slice(0, 6).map((file) => file.name);
  assert.deepEqual(requestedInOrder, expectedOrder, 'the first covers asked for must be the top of the list');

  const summary = {
    total: TOTAL,
    firstCommitRendered: firstRendered,
    mountedCards,
    worstFrameGapMs: worstFrameGap,
    thumbnailRequestsBeforeScroll: thumbnailLog.length,
    maxConcurrentThumbnailRequests: maxInFlight,
  };
  console.log(JSON.stringify(summary, null, 2));
  // 증거 디렉터리를 주면 요약과 화면을 남긴다.
  const evidenceDir = process.env.PDFIT_EVIDENCE_DIR;
  if (evidenceDir) {
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(path.join(evidenceDir, 'summary.json'), JSON.stringify({ ...summary, thumbnailLog: thumbnailLog.slice(0, 40) }, null, 2), 'utf8');
    await page.screenshot({ path: path.join(evidenceDir, 'covers-mounted.png'), fullPage: false });
  }
  console.log('large-library-progressive-browser passed');
} finally {
  await browser.close();
  server.close();
}
