import assert from 'node:assert/strict';
import { mkdir, open, rm } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.PDFIT_TEST_BASE_URL ?? 'http://127.0.0.1:15201';
const folderName = process.env.PDFIT_TEST_FOLDER ?? '이북';
const filename = `codex-large-upload-${Date.now()}.pdf`;
const tempDir = path.resolve('.tmp', 'large-upload-test');
const filePath = path.join(tempDir, filename);
const fileSize = 201 * 1024 * 1024;
const browser = await chromium.launch({ headless: true });

try {
  await mkdir(tempDir, { recursive: true });
  const handle = await open(filePath, 'wx');
  try {
    await handle.truncate(fileSize);
    await handle.write(Buffer.from('%PDF-1.4'), 0, 8, 0);
  } finally {
    await handle.close();
  }

  const context = await browser.newContext({ baseURL: baseUrl });
  const page = await context.newPage();
  await page.goto(`/folder/${encodeURIComponent(folderName)}`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('folder-drop-zone').waitFor({ state: 'visible' });

  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
      && response.url().includes(`/api/folders/${encodeURIComponent(folderName)}/files`)
  ), { timeout: 120_000 });
  await page.locator('input[type="file"]').setInputFiles(filePath);
  const response = await responsePromise;
  const responseText = await response.text();
  assert.equal(response.status(), 200, `large upload failed: ${response.status()} ${responseText}`);
  assert.match(responseText, new RegExp(filename));
  await context.close();
  console.log(`large browser upload passed: ${fileSize} bytes`);
} finally {
  await fetch(`${baseUrl}/api/folders/${encodeURIComponent(folderName)}/files/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
  }).catch(() => undefined);
  await rm(filePath, { force: true });
  await browser.close();
}
