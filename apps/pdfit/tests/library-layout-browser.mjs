import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.PDFIT_TEST_BASE_URL ?? 'http://127.0.0.1:15201';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

async function tagLayout(path) {
  await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
  const row = page.locator('.pdfit-pdf-row:has([data-testid="pdf-tag-values"] > *)').first();
  await row.waitFor({ state: 'visible', timeout: 30_000 });
  return row.evaluate((element) => {
    const box = (selector) => element.querySelector(selector)?.getBoundingClientRect();
    const chip = element.querySelector('[data-testid="pdf-tag-values"]')?.lastElementChild?.getBoundingClientRect();
    const tagColumn = box('[data-testid="pdf-list-tags"]');
    const values = box('[data-testid="pdf-tag-values"]');
    const actions = box('[data-testid="pdf-tag-actions"]');
    const manage = box('.pdfit-row-action-tags');
    const ai = box('[data-testid="pdf-ai-auto-tag"]');
    return { rowHeight: element.getBoundingClientRect().height, tagColumnLeft: tagColumn?.left, tagColumnWidth: tagColumn?.width, valuesWidth: values?.width, actionsWidth: actions?.width, chipRight: chip?.right, valuesRight: values?.right, actionsLeft: actions?.left, manageLeft: manage?.left, manageRight: manage?.right, aiLeft: ai?.left, chipToManageGap: manage && chip ? manage.left - chip.right : undefined, manageToAiGap: ai && manage ? ai.left - manage.right : undefined, valuesAlign: getComputedStyle(element.querySelector('[data-testid="pdf-tag-values"]')).justifyContent, actionsAlign: getComputedStyle(element.querySelector('[data-testid="pdf-tag-actions"]')).justifyContent, actionText: element.querySelector('.pdfit-row-action-tags')?.textContent?.trim(), ai: Boolean(element.querySelector('[data-testid="pdf-ai-auto-tag"]')) };
  });
}

try {
  const signIn = await context.request.post(`${baseUrl}/api/auth/local-preview`, { headers: { Origin: baseUrl } });
  assert.equal(signIn.status(), 200);
  const tag = await tagLayout('/tag/%EB%94%94%EC%9E%90%EC%9D%B8');
  const folder = await tagLayout('/folder/PDFit%20Library');
  assert.equal(tag.actionText, '태그관리');
  assert.equal(folder.actionText, '태그관리');
  assert.equal(tag.chipToManageGap, 12);
  assert.equal(folder.chipToManageGap, 12);
  assert.equal(folder.manageToAiGap, 12);
  assert.ok(Math.abs(tag.manageLeft - folder.manageLeft) <= 2, `manage label not aligned: ${JSON.stringify({ tag, folder })}`);
  assert.ok(Math.abs(tag.tagColumnWidth - folder.tagColumnWidth) <= 2, `tag columns have different widths: ${JSON.stringify({ tag, folder })}`);
  assert.ok(Math.abs(tag.tagColumnLeft - folder.tagColumnLeft) <= 2, `tag columns have different positions: ${JSON.stringify({ tag, folder })}`);
  assert.equal(tag.tagColumnWidth, 208);
  assert.equal(tag.rowHeight, 50);
  assert.equal(folder.rowHeight, 50);
  assert.equal(tag.ai, false);
  assert.equal(folder.ai, true);

  const selections = page.getByTestId('pdf-selection-checkbox');
  await selections.nth(0).check();
  await selections.nth(1).check();
  const selectAll = page.getByRole('checkbox', { name: '전체 선택' }).first();
  assert.equal(await selectAll.evaluate((checkbox) => checkbox.indeterminate), false);
  assert.equal(await selectAll.isChecked(), false);
  const selectionState = { selectAllChecked: await selectAll.isChecked(), selectAllIndeterminate: await selectAll.evaluate((checkbox) => checkbox.indeterminate) };
  await page.goto(`${baseUrl}/bookmarks`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('bookmark-library-page').waitFor({ state: 'visible' });
  await page.getByText('보관한 페이지가 없습니다.').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByText('문서에서 중요한 부분을 선택해 보관함에 저장해 보세요.').waitFor({ state: 'visible' });
  await page.getByText('PRO 이용권').first().waitFor({ state: 'visible' });
  console.log(JSON.stringify({ tag, folder, ...selectionState, emptyArchiveGuide: true, proPassLabel: true }, null, 2));
} finally {
  await browser.close();
}
