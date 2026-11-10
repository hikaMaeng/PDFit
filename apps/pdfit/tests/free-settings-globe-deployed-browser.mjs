// Read-only check of a deployed Free app: the upper-left button is a globe that opens the
// language/theme dialog, the Settings page has only the AI servers tab, and nothing is saved.
// Env: PDFIT_BASE_URL (default http://127.0.0.1:15203), PDFIT_EVIDENCE_DIR, PDFIT_BROWSER_CHANNEL.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.PDFIT_BASE_URL ?? 'http://127.0.0.1:15203';
const evidenceDir = process.env.PDFIT_EVIDENCE_DIR ?? '.';
mkdirSync(evidenceDir, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PDFIT_BROWSER_CHANNEL || undefined });
const result = { baseUrl, consoleErrors: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', (message) => { if (message.type() === 'error') result.consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => result.consoleErrors.push(String(error)));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  const globe = page.getByTestId('lnb-preferences');
  await globe.waitFor();
  result.globeIconTestId = await globe.locator('svg').first().getAttribute('data-testid');
  assert.equal(result.globeIconTestId, 'LanguageIcon', 'upper-left button must use the globe icon');
  result.globeName = await globe.getAttribute('aria-label');
  await page.screenshot({ path: join(evidenceDir, 'header.png'), clip: { x: 0, y: 0, width: 420, height: 90 } });
  await globe.click();
  await page.getByTestId('preferences-dialog').waitFor();
  result.dialogHasLanguage = await page.getByTestId('preferences-language').count();
  result.dialogHasColorMode = await page.getByTestId('preferences-color-mode').count();
  await page.getByRole('button', { name: /^(Close|닫기)$/ }).click();

  await page.goto(`${baseUrl}/settings`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab').first().waitFor();
  result.tabs = await page.getByRole('tab').allTextContents();
  assert.equal(result.tabs.length, 1, `Settings must have one tab, got ${JSON.stringify(result.tabs)}`);
  assert.equal(await page.getByText(/PGVector/i).count(), 0, 'PGVector must not appear in Settings');
  await page.screenshot({ path: join(evidenceDir, 'settings.png') });
} finally {
  await browser.close();
}
writeFileSync(join(evidenceDir, 'settings-globe.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
assert.equal(result.consoleErrors.length, 0, `${result.consoleErrors.length} console error(s)`);
