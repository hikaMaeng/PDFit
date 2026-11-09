import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
await mkdir('apps/pdfit/tests/reports/tag-input-tablet/20261006', { recursive: true });
const origin = 'http://127.0.0.1:15201';
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1024, height: 1180 }, isMobile: true, hasTouch: true, locale: 'ko-KR' });
    await context.request.post(`${origin}/api/auth/local-preview`, { headers: { Origin: origin } });
    const page = await context.newPage();
    const mutations = [];
    let releaseMutation;
    let pendingRequest;
    const gate = new Promise((resolve) => { releaseMutation = resolve; });
    const arrived = new Promise((resolve) => { pendingRequest = resolve; });
    let firstAdd = true;
    await page.route('**/api/tags/**', async (route) => {
      if (['POST', 'PATCH', 'DELETE'].includes(route.request().method())) {
        if (route.request().method() === 'POST' && firstAdd) { firstAdd = false; pendingRequest(); await gate; }
        mutations.push({ url: route.request().url(), body: route.request().postDataJSON() });
        await route.fulfill({ json: { ok: true } });
      } else await route.continue();
    });
    await page.goto(`${origin}/folder/PDFit%20Library`);
    await page.locator('.pdfit-row-action-tags').first().waitFor();
    await page.route('**/api/folders/refresh', (route) => route.fulfill({ json: { ok: true } }));
    const existingRow = await page.locator('.pdfit-pdf-row').first().elementHandle();
    await page.getByTestId('refresh-folder').click();
    for (let attempt = 0; attempt < 100 && await page.getByTestId('refresh-folder').isDisabled(); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(await page.getByTestId('refresh-folder').isEnabled(), true);
    assert.equal(await existingRow.evaluate((element) => element.isConnected), true);
    await page.locator('.pdfit-row-action-tags').first().click();
    const dialog = page.getByRole('dialog');
    const input = dialog.getByPlaceholder('태그 추가 또는 목록에서 선택');
    await input.waitFor();
    await dialog.getByRole('button',{name:'파일 자동 분류',exact:true}).waitFor();
    const colors = () => input.evaluate((element) => { const root = element.closest('.MuiFormControl-root'); return [getComputedStyle(root.querySelector('fieldset')).borderColor, getComputedStyle(root.querySelector('label')).color]; });
    await page.mouse.move(0, 0);
    assert.equal(await input.evaluate((element) => element === document.activeElement), false);
    assert.ok((await colors()).every((color) => color !== 'rgb(59, 130, 246)'));
    await page.screenshot({ path: `apps/pdfit/tests/reports/tag-input-tablet/20261006/${engine.name()}-idle.png` });
    await input.hover();
    for (let attempt = 0; attempt < 20 && (await colors())[1] !== 'rgb(59, 130, 246)'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(await colors(), ['rgb(59, 130, 246)', 'rgb(59, 130, 246)']);
    await page.screenshot({ path: `apps/pdfit/tests/reports/tag-input-tablet/20261006/${engine.name()}-hover.png` });
    await page.mouse.move(0, 0);
    const addButton = dialog.getByTestId('add-tag-button');
    assert.equal(await addButton.isEnabled(), true);
    assert.equal(await addButton.evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(59, 130, 246)');
    await addButton.click();
    assert.equal(await input.evaluate((element) => element === document.activeElement), true);
    assert.equal(mutations.length, 0);
    await input.blur();
    const idleColors = await input.evaluate((element) => {
      const root = element.closest('.MuiFormControl-root');
      return { border: getComputedStyle(root.querySelector('fieldset')).borderColor, label: getComputedStyle(root.querySelector('label')).color };
    });
    assert.notEqual(idleColors.border, 'rgb(59, 130, 246)');
    assert.notEqual(idleColors.label, 'rgb(59, 130, 246)');
    await input.focus();
    assert.equal(await input.evaluate((element) => getComputedStyle(element.closest('.MuiOutlinedInput-root').querySelector('fieldset')).borderColor), 'rgb(59, 130, 246)');
    await input.fill('태블릿엔터검증');
    await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
    assert.equal(mutations.length, 0);
    await input.press('Enter');
    await arrived;
    assert.equal(await dialog.locator('.MuiChip-root').filter({ hasText: '태블릿엔터검증' }).count(), 0);
    assert.equal(await addButton.isDisabled(), true);
    releaseMutation();
    await page.getByText('"태블릿엔터검증" 태그가 추가되었습니다.', { exact: true }).waitFor();
    assert.ok(mutations.some((item) => item.body?.color === '#3b82f6'));
    assert.equal(await dialog.locator('.MuiChip-root').filter({ hasText: '태블릿엔터검증' }).count(), 1);
    assert.equal(await dialog.getByTestId('pdf-tag-chip').filter({hasText:'태블릿엔터검증'}).locator('.MuiChip-label').innerText(), '# 태블릿엔터검증');
    assert.equal(await dialog.getByTestId('pdf-tag-chip').filter({hasText:'태블릿엔터검증'}).locator('.MuiChip-deleteIcon').count(), 1);
    await dialog.getByRole('button', { name: '새 태그 색상', exact: true }).click();
    await page.getByRole('button', { name: '#ef4444', exact: true }).click();
    await input.fill('사용자색상검증');
    await dialog.getByTestId('add-tag-button').click();
    await page.getByText('"사용자색상검증" 태그가 추가되었습니다.', { exact: true }).waitFor();
    assert.ok(mutations.some((item) => item.body?.color === '#ef4444'));
    assert.equal(await dialog.getByTestId('tag-color-swatch').evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(239, 68, 68)');
    await page.reload();
    await page.locator('.pdfit-row-action-tags').first().click();
    assert.equal(await page.getByRole('dialog').getByTestId('tag-color-swatch').evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(239, 68, 68)');
    console.log(`${engine.name()}: tablet Enter, composition guard, add button, default blue, selected red, remember red after reload passed`);
    await context.close();
  } finally { await browser.close(); }
}
