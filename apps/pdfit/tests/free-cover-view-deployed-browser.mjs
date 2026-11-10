// Read-only smoke check of the cover (image list) view on a deployed standalone
// PDFit server. Covers of local files are JPEGs rendered by the server's background
// thumbnail task; the browser must only display them and must not download PDFs.
// The script only reads pages; the view choice is stored in this headless profile's
// localStorage and discarded.
//
// Usage: PDFIT_BASE_URL=http://127.0.0.1:15203 PDFIT_EVIDENCE_DIR=test/<date>/<run> \
//        node apps/pdfit/tests/free-cover-view-deployed-browser.mjs
// Optional: PDFIT_FOLDER, PDFIT_MIN_READY_COVERS (default 4), PDFIT_BROWSER_CHANNEL=chrome,
//           PDFIT_WAIT_TASKS_IDLE_SECONDS (wait for the task queue to drain first),
//           PDFIT_SCROLL_CARD_INDEX (scroll to that card and time the covers on screen).
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.PDFIT_BASE_URL ?? 'http://127.0.0.1:15203';
const folder = process.env.PDFIT_FOLDER ?? '이북';
const evidenceDir = process.env.PDFIT_EVIDENCE_DIR;
const minReadyCovers = Number(process.env.PDFIT_MIN_READY_COVERS ?? '4');
const waitIdleSeconds = Number(process.env.PDFIT_WAIT_TASKS_IDLE_SECONDS ?? '0');
const scrollCardIndex = Number(process.env.PDFIT_SCROLL_CARD_INDEX ?? '-1');

async function taskStatus() {
  const response = await fetch(`${baseUrl}/api/tasks/status`);
  assert.equal(response.status, 200, 'the deployed server must expose /api/tasks/status');
  return response.json();
}

function summarize(status) {
  const thumbnail = status.types.find((type) => type.type === 'thumbnail');
  return {
    intervalMs: status.intervalMs, concurrency: status.concurrency, planCount: status.planCount, nextPlanAt: status.nextPlanAt,
    pending: status.pending, active: status.active,
    thumbnail: thumbnail && { planned: thumbnail.planned, pending: thumbnail.pending, running: thumbnail.running, completedSincePlan: thumbnail.completedSincePlan, failedSincePlan: thumbnail.failedSincePlan, completedTotal: thumbnail.completedTotal, failedTotal: thumbnail.failedTotal, lastPlanAt: thumbnail.lastPlanAt, lastPlanDurationMs: thumbnail.lastPlanDurationMs, lastPlanError: thumbnail.lastPlanError },
    lastPlan: status.details?.thumbnail?.lastPlan ?? null,
  };
}

const statusAtStart = summarize(await taskStatus());
let statusAfterWait = null;
if (waitIdleSeconds > 0) {
  const deadline = Date.now() + waitIdleSeconds * 1000;
  for (;;) {
    const status = await taskStatus();
    if (status.planCount > 0 && status.pending === 0 && status.active === 0 && !status.planning) { statusAfterWait = summarize(status); break; }
    assert.ok(Date.now() < deadline, `task queue did not drain within ${waitIdleSeconds}s: ${JSON.stringify(summarize(status))}`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

// Set PDFIT_BROWSER_CHANNEL=chrome to use an installed Chrome instead of the
// Playwright-managed Chromium build.
const channel = process.env.PDFIT_BROWSER_CHANNEL || undefined;
const browser = await chromium.launch({ headless: true, channel });
const consoleErrors = [];
const pdfRequests = [];
const thumbnailResponses = {};
let maxRetryAttempt = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (/^\/api\/folders\/[^/]+\/files\/[^/]+$/.test(pathname)) pdfRequests.push(decodeURIComponent(pathname));
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (!url.pathname.endsWith('/thumbnail')) return;
    thumbnailResponses[response.status()] = (thumbnailResponses[response.status()] ?? 0) + 1;
    maxRetryAttempt = Math.max(maxRetryAttempt, Number(url.searchParams.get('r') ?? '0'));
  });
  await page.goto(`${baseUrl}/folder/${encodeURIComponent(folder)}`, { waitUntil: 'domcontentloaded' });
  const version = (await page.locator('body').innerText()).match(/v\d+\.\d+\.\d+/)?.[0] ?? null;

  const listCount = await page.getByTestId('pdf-cover-grid').count();
  assert.equal(listCount, 0, 'a fresh profile should start in list view');

  await page.getByRole('button', { name: /Cover view|표지 보기/ }).click();
  const grid = page.getByTestId('pdf-cover-grid');
  await grid.waitFor({ state: 'visible' });
  const cards = await grid.getByTestId('pdf-cover-card').count();

  // Optional: jump to a card deep in the list, where covers are usually not rendered
  // yet, and time how long the cards on screen take to get their covers. Being on
  // screen queues a cover ahead of the periodic backlog.
  let scrolled = null;
  if (scrollCardIndex >= 0 && scrollCardIndex < cards) {
    const visibleStates = () => page.evaluate(() => {
      const histogram = {};
      for (const host of document.querySelectorAll('[data-testid="pdf-cover-thumbnail"]')) {
        const rect = host.getBoundingClientRect();
        if (rect.bottom <= 0 || rect.top >= window.innerHeight) continue;
        const state = host.getAttribute('data-cover-state') ?? 'n/a';
        histogram[state] = (histogram[state] ?? 0) + 1;
      }
      return histogram;
    });
    await grid.getByTestId('pdf-cover-card').nth(scrollCardIndex).scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    const onArrival = await visibleStates();
    const started = Date.now();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="pdf-cover-thumbnail"]')]
      .filter((host) => { const rect = host.getBoundingClientRect(); return rect.bottom > 0 && rect.top < window.innerHeight; })
      .every((host) => host.getAttribute('data-cover-state') === 'ready' || host.getAttribute('data-cover-state') === 'failed'), undefined, { timeout: 240_000 });
    scrolled = { cardIndex: scrollCardIndex, visibleStatesOnArrival: onArrival, visibleStatesWhenSettled: await visibleStates(), secondsUntilVisibleCoversSettled: Number(((Date.now() - started) / 1000).toFixed(1)), backlogWhenSettled: summarize(await taskStatus()).thumbnail?.pending ?? null };
    if (evidenceDir) { mkdirSync(evidenceDir, { recursive: true }); await page.screenshot({ path: path.join(evidenceDir, 'cover-view-scrolled.png') }); }
  }

  // A ready cover is a loaded <img> served by the thumbnail route.
  const readySelector = '[data-testid="pdf-cover-thumbnail"][data-cover-source="server"][data-cover-state="ready"] img';
  await page.waitForFunction(({ selector, min }) => [...document.querySelectorAll(selector)].filter((image) => image.complete && image.naturalWidth > 0).length >= min,
    { selector: readySelector, min: minReadyCovers }, { timeout: 180_000 });
  // Let the rest of the first screen settle so the state histogram is meaningful.
  await page.waitForTimeout(3000);

  const covers = await page.evaluate((selector) => [...document.querySelectorAll(selector)].slice(0, 8).map((image) => {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonWhite = 0;
    let samples = 0;
    for (let offset = 0; offset < data.length; offset += 4 * 97) {
      samples += 1;
      if (data[offset] < 240 || data[offset + 1] < 240 || data[offset + 2] < 240) nonWhite += 1;
    }
    return { src: decodeURIComponent(new URL(image.src).pathname + new URL(image.src).search).slice(0, 160), naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, nonWhiteRatio: Number((nonWhite / samples).toFixed(3)) };
  }), readySelector);
  assert.ok(covers.length >= minReadyCovers, 'enough ready covers to sample');
  assert.ok(covers.every((cover) => cover.naturalWidth === 360), 'server thumbnails are 360px wide');
  assert.ok(covers.every((cover) => /\/thumbnail\?v=\d+-\d+/.test(cover.src)), 'cover URLs carry the source stamp');
  assert.ok(covers.every((cover) => cover.nonWhiteRatio > 0), 'covers must contain drawn (non-white) pixels');

  const states = await page.evaluate(() => {
    const histogram = {};
    for (const host of document.querySelectorAll('[data-testid="pdf-cover-thumbnail"]')) {
      const key = `${host.getAttribute('data-cover-source') ?? 'client'}:${host.getAttribute('data-cover-state') ?? 'n/a'}`;
      histogram[key] = (histogram[key] ?? 0) + 1;
    }
    return { histogram, canvases: document.querySelectorAll('[data-testid="pdf-cover-thumbnail"] canvas').length };
  });
  assert.equal(states.canvases, 0, 'no browser-side PDF canvas may exist in server-cover mode');
  // A queued cover is asked for again after 3, 6, 12, 30, then every 60 seconds. A card
  // that retries more often than that is hammering the server instead of waiting.
  assert.ok(maxRetryAttempt <= 8, `a cover was requested ${maxRetryAttempt} times in one short visit`);
  assert.deepEqual(pdfRequests, [], 'the cover view must not download PDF files');

  const firstCard = (await grid.getByTestId('pdf-cover-card').first().innerText()).replace(/\n+/g, ' | ');
  const storedView = await page.evaluate(() => localStorage.getItem('pdfit.library.view'));
  assert.equal(storedView, 'covers', 'the chosen view should persist for the next visit');

  const result = {
    baseUrl, folder, browser: `${channel ?? 'chromium'} ${browser.version()}`, version, cards,
    statusAtStart, statusAfterWait, statusAtEnd: summarize(await taskStatus()),
    scrolled, coverStates: states.histogram, thumbnailResponses, maxRetryAttempt, pdfRequests: pdfRequests.length,
    readyCoversSampled: covers, firstCard, storedView, consoleErrors,
  };
  if (evidenceDir) {
    mkdirSync(evidenceDir, { recursive: true });
    await page.screenshot({ path: path.join(evidenceDir, 'cover-view.png') });
    writeFileSync(path.join(evidenceDir, 'cover-view.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
