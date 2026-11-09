import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const origin = 'http://127.0.0.1:15201';
  await context.request.post(origin + '/api/auth/local-preview', { headers: { Origin: origin } });
  await context.addInitScript(() => localStorage.setItem('pdfit.library.view', 'list'));
  const page = await context.newPage();
  const summaries = await (await context.request.get(origin + '/api/tags/summary')).json();
  const tag = summaries.find(item => item.bookCount > 0);
  assert.ok(tag);
  await page.goto(origin + '/tag/' + encodeURIComponent(tag.name));
  await page.getByTestId('tag-refresh').waitFor();
  assert.equal(await page.getByTestId('pdf-select-all').count(), 0);
  assert.equal(await page.getByTestId('pdf-selection-checkbox').count(), 0);
  assert.equal(await page.locator('.pdfit-row-action-move, .pdfit-row-action-delete').count(), 0);
  await page.getByTestId('tag-refresh').click();
  await page.getByRole('button', { name: '표지 보기', exact: true }).click();
  await page.getByTestId('pdf-cover-card').first().waitFor();
  assert.equal(await page.getByTestId('pdf-cover-selection').count(), 0);
  assert.equal(await page.getByTestId('pdf-cover-file-actions').count(), 0);
  await page.getByRole('button', { name: '목록 보기', exact: true }).click();
  await page.locator('.pdfit-row-action-tags').first().waitFor();
  console.log('태그 화면 새로고침, 목록/표지 전환, 선택 및 이동/삭제 제거 통과');
} finally { await browser.close(); }
