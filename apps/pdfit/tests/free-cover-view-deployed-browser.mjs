// Read-only smoke check of the cover (image list) view on a deployed standalone
// PDFit server. Local files have no driveFileId, so covers must come from the
// browser-side PDF.js first-page render. The script only reads pages; the view
// choice is stored in this headless profile's localStorage and discarded.
//
// Usage: PDFIT_BASE_URL=http://127.0.0.1:15203 PDFIT_EVIDENCE_DIR=test/<date>/<run> \
//        node apps/pdfit/tests/free-cover-view-deployed-browser.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.PDFIT_BASE_URL ?? 'http://127.0.0.1:15203';
const folder = process.env.PDFIT_FOLDER ?? '이북';
const evidenceDir = process.env.PDFIT_EVIDENCE_DIR;
const minReadyCovers = Number(process.env.PDFIT_MIN_READY_COVERS ?? '4');

// Set PDFIT_BROWSER_CHANNEL=chrome to use an installed Chrome instead of the
// Playwright-managed Chromium build.
const channel = process.env.PDFIT_BROWSER_CHANNEL || undefined;
const browser = await chromium.launch({ headless: true, channel });
const consoleErrors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto(`${baseUrl}/folder/${encodeURIComponent(folder)}`, { waitUntil: 'domcontentloaded' });
  const version = (await page.locator('body').innerText()).match(/v\d+\.\d+\.\d+/)?.[0] ?? null;

  const listCount = await page.getByTestId('pdf-cover-grid').count();
  assert.equal(listCount, 0, 'a fresh profile should start in list view');

  await page.getByRole('button', { name: /Cover view|표지 보기/ }).click();
  const grid = page.getByTestId('pdf-cover-grid');
  await grid.waitFor({ state: 'visible' });
  const cards = await grid.getByTestId('pdf-cover-card').count();

  // Local covers have no provider thumbnail; a ready cover is a visible canvas.
  await page.waitForFunction((min) => [...document.querySelectorAll('[data-testid="pdf-cover-thumbnail"] canvas')]
    .filter((canvas) => canvas.style.display === 'block').length >= min, minReadyCovers, { timeout: 120_000 });

  const covers = await page.evaluate(() => [...document.querySelectorAll('[data-testid="pdf-cover-thumbnail"] canvas')]
    .filter((canvas) => canvas.style.display === 'block')
    .slice(0, 8)
    .map((canvas) => {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const colors = new Set();
      for (let offset = 0; offset < data.length; offset += 4 * 97) colors.add(`${data[offset] >> 4}-${data[offset + 1] >> 4}-${data[offset + 2] >> 4}`);
      return { width: canvas.width, height: canvas.height, sampledColors: colors.size };
    }));
  assert.ok(covers.every((cover) => cover.sampledColors > 1), 'rendered covers must not be blank canvases');

  const firstCard = (await grid.getByTestId('pdf-cover-card').first().innerText()).replace(/\n+/g, ' | ');
  const storedView = await page.evaluate(() => localStorage.getItem('pdfit.library.view'));
  assert.equal(storedView, 'covers', 'the chosen view should persist for the next visit');

  const result = { baseUrl, folder, browser: `${channel ?? 'chromium'} ${browser.version()}`, version, cards, readyCoversSampled: covers, firstCard, storedView, consoleErrors };
  if (evidenceDir) {
    mkdirSync(evidenceDir, { recursive: true });
    await page.screenshot({ path: path.join(evidenceDir, 'cover-view.png') });
    writeFileSync(path.join(evidenceDir, 'cover-view.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
