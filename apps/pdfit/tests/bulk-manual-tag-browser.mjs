import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
try {
  const origin = 'http://127.0.0.1:15201';
  const context = await browser.newContext();
  await context.request.post(origin + '/api/auth/local-preview', { headers: { Origin: origin } });
  await context.addInitScript(() => localStorage.setItem('pdfit.library.view', 'list'));
  const page = await context.newPage();
  let added = 0;
  await page.route('**/api/tags/book/**', route => {
    if (route.request().method() === 'POST') { added++; return route.fulfill({ json: { ok: true } }); }
    return route.fulfill({ json: [] });
  });
  await page.route('**/api/tags/*/color', route => route.fulfill({ json: { ok: true } }));
  await page.goto(origin + '/folder/cvzxv');
  await page.getByTestId('pdf-select-all').waitFor();
  const count = await page.getByTestId('pdf-selection-checkbox').count();
  assert.ok(count > 1);
  const management = page.getByTestId('bulk-manual-tag-management');
  assert.equal(await management.count(), 0);
  await page.getByTestId('pdf-selection-checkbox').first().check();
  assert.equal(await management.count(), 0);
  await page.getByTestId('pdf-select-all').click();
  await management.waitFor();
  assert.equal(await management.evaluate(el => getComputedStyle(el).textDecorationLine), 'underline');
  await management.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox').fill('일괄테스트');
  await dialog.getByRole('button', { name: '추가', exact: true }).click();
  await dialog.getByRole('alert').waitFor();
  assert.equal(added, count);
  assert.match(await dialog.getByRole('alert').innerText(), /파일에 태그를 추가했습니다/);
  await dialog.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByTestId('pdf-select-all').click();
  assert.equal(await management.count(), 0);
  console.log('전체선택 전용 태그관리 및 모든 선택 파일 수동 추가 통과 (API fixture)');
} finally { await browser.close(); }
