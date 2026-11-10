import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = process.env.PDFIT_TEST_BASE_URL ?? 'http://127.0.0.1:15201';
const output = 'apps/pdfit/tests/reports/lnb-search-beige/20261002';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 1024, height: 1180 }]) {
    const context = await browser.newContext({ viewport, locale: 'ko-KR' });
    await context.addInitScript(() => { localStorage.setItem('pdfit.color-mode', 'light'); localStorage.setItem('pdfit.library.view', 'list'); });
    const login = await context.request.post(`${origin}/api/auth/local-preview`, { headers: { Origin: origin } });
    assert.equal(login.status(), 200);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}/folder/PDFit%20Library`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('pdf-search-button').waitFor();
    const me = await (await context.request.get(`${origin}/api/auth/me`)).json();
    const identity = await page.locator('.pdfit-pdf-row a').first().getAttribute('href');
    const fileId = new URL(identity, origin).searchParams.get('driveFileId');
    assert.ok(fileId);
    for (const [date, expected] of [['2026-10-01T03:00:00Z', '10월 1일'], ['2025-09-30T03:00:00Z', '2025년 9월 30일']]) {
      await page.evaluate(({ scope, fileId, date }) => {
        localStorage.setItem(`pdfit.opened-at.v1.${encodeURIComponent(scope)}`, JSON.stringify({ [fileId]: date }));
        window.dispatchEvent(new Event('pdfit-document-opened'));
      }, { scope: me.user.id, fileId, date });
      assert.equal(await page.getByTestId('pdf-opened-at').first().innerText(), expected);
    }
    const headings = await page.getByTestId('pdf-list-header').locator('.MuiTypography-root').evaluateAll((elements) => elements.map((element) => getComputedStyle(element).textAlign));
    assert.deepEqual(headings, ['left', 'left', 'left', 'left', 'left']);
    assert.deepEqual(await page.getByTestId('pdf-list-header').locator('.MuiTypography-root').allTextContents(), ['파일명', '태그', '문서정보', '시간', '파일 크기']);
    const info = page.getByTestId('pdf-document-info').first();
    assert.equal(await info.innerText(), '문서정보');
    assert.equal(await info.evaluate((element) => getComputedStyle(element).textDecorationLine), 'underline');
    const rowOrder = await page.locator('.pdfit-pdf-row').first().evaluate((row) => ['[data-testid="pdf-filename-line"]', '[data-testid="pdf-list-tags"]', '[data-testid="pdf-document-info"]', '[data-testid="pdf-opened-at"]', '[data-testid="pdf-file-size"]'].map((selector) => row.querySelector(selector).getBoundingClientRect().x));
    assert.deepEqual(rowOrder, [...rowOrder].sort((a, b) => a - b));
    await page.getByTestId('lnb-tags-section').getByText('태그', { exact: true }).waitFor();
    await page.getByTestId('lnb-folders-section').getByText('폴더', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '태그 전체 초기화', exact: true }).count(), 0);
    assert.equal(await page.getByTestId('folder-title-summary').locator('.MuiChip-root').count(), 0);
    const count = page.getByTestId('folder-document-count');
    await count.waitFor();
    assert.match(await count.innerText(), /\d+개/);
    const countBox = await count.boundingBox();
    const checkboxBox = await page.getByTestId('pdf-select-all').boundingBox();
    assert.ok(countBox.x >= checkboxBox.x + checkboxBox.width);
    assert.equal(await page.getByTestId('folder-header-actions').evaluate((element) => getComputedStyle(element).gap), '12px');
    const aiBox = await page.getByTestId('ai-auto-tag-all').boundingBox();
    const viewBox = await page.locator('.MuiToggleButtonGroup-root').filter({ has: page.getByRole('button', { name: '표지 보기', exact: true }) }).boundingBox();
    assert.equal(Math.round(viewBox.x - aiBox.x - aiBox.width), 24);
    const searchBox = await page.getByTestId('pdf-search-button').boundingBox();
    const titleBox = await page.getByTestId('folder-title-row').boundingBox();
    assert.ok(searchBox.x >= titleBox.x + titleBox.width);
    assert.ok(Math.abs(searchBox.y - titleBox.y) < 10);
    const sidebarColor = await page.locator('.MuiDrawer-paper').evaluate((element) => getComputedStyle(element).backgroundColor);
    assert.equal(sidebarColor, 'rgb(255, 241, 217)');
    const footer = page.getByTestId('account-footer');
    const footerColors = await footer.locator('.MuiTypography-root').evaluateAll((elements) => elements.map((element) => getComputedStyle(element).color));
    assert.deepEqual(footerColors.slice(0, 2), ['rgb(64, 58, 48)', 'rgb(111, 101, 86)']);
    assert.equal(await footer.getByTestId('account-access-status').evaluate((element) => getComputedStyle(element).color), 'rgb(46, 103, 68)');
    await page.screenshot({ path: `${output}/library-${viewport.width}.png`, fullPage: true });
    await page.getByTestId('pdf-search-button').click();
    await page.getByTestId('pdf-search-input').fill('no-such-document-20261002');
    const empty = page.getByTestId('pdf-search-empty');
    await empty.getByText('일치하는 파일이 없습니다.', { exact: true }).waitFor();
    assert.equal(await page.getByTestId('pdf-search-result-count').count(), 0);
    assert.equal(await empty.locator('[data-testid="FindInPageOutlinedIcon"]').count(), 1);
    await page.screenshot({ path: `${output}/search-${viewport.width}.png`, fullPage: true });
    await empty.getByRole('button', { name: '검색어 지우기', exact: true }).click();
    assert.equal(await page.getByTestId('pdf-search-input').inputValue(), '');
    assert.equal(await empty.count(), 0);
    await page.getByTestId('lnb-bookmarks').getByText('클립', { exact: true }).waitFor();
    assert.equal(await page.getByTestId('lnb-bookmarks').getByTestId('AttachFileIcon').count(), 1);
    await page.getByRole('button', { name: '표지 보기', exact: true }).click();
    const cover = page.getByTestId('pdf-cover-card').first();
    await cover.waitFor();
    const titleRow = cover.getByTestId('pdf-cover-title-row');
    const media = cover.getByTestId('pdf-cover-media');
    const actions = cover.getByTestId('pdf-cover-actions');
    assert.equal(await titleRow.getByTestId('pdf-cover-selection').count(), 1);
    const checkBox = await titleRow.getByTestId('pdf-cover-selection').boundingBox();
    const nameBox = await titleRow.locator('a').boundingBox();
    assert.ok(checkBox.x + checkBox.width <= nameBox.x);
    assert.equal(await actions.getByTestId('pdf-cover-selection').count(), 0);
    // 카드 높이 = 썸네일 + 버튼 4종. 버튼 사이 구분선은 없고 균등 4분할이다.
    assert.equal(await cover.getByTestId('pdf-cover-action-divider').count(), 0);
    assert.equal(await cover.getByTestId('pdf-cover-tag-actions').getByRole('button').count(), 2);
    assert.equal(await cover.getByTestId('pdf-cover-file-actions').getByRole('button').count(), 2);
    const buttonBoxes = await actions.getByRole('button').evaluateAll((elements) => elements.map((element) => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; }));
    assert.equal(buttonBoxes.length, 4);
    for (let index = 1; index < buttonBoxes.length; index += 1) {
      assert.ok(Math.abs(buttonBoxes[index].width - buttonBoxes[0].width) < 1, '버튼 폭이 균등하지 않음');
      assert.ok(Math.abs(buttonBoxes[index].x - (buttonBoxes[index - 1].x + buttonBoxes[index - 1].width)) < 1, '버튼 사이에 빈틈이 있음');
    }
    const [cardBox, mediaBox, actionsBox, bandBox] = await Promise.all([cover.boundingBox(), media.boundingBox(), actions.boundingBox(), titleRow.boundingBox()]);
    assert.ok(Math.abs(mediaBox.y + mediaBox.height - actionsBox.y) < 1, '버튼이 썸네일 바로 밑에 붙어야 함');
    assert.ok(cardBox.y + cardBox.height - (actionsBox.y + actionsBox.height) <= 2, '카드가 버튼 행에서 끝나야 함');
    assert.ok(Math.abs(bandBox.y + bandBox.height - (mediaBox.y + mediaBox.height)) < 1, '제목 띠가 썸네일 하단에 올려져야 함');
    assert.match(await titleRow.evaluate((element) => getComputedStyle(element).backgroundColor), /^rgba\(0, 0, 0, 0\.\d+\)$/);
    await titleRow.getByRole('checkbox').check();
    assert.equal(await titleRow.getByRole('checkbox').isChecked(), true);
    await titleRow.getByRole('checkbox').uncheck();
    assert.equal(await page.getByTestId('pdf-list-header').count(), 0);
    // 정보는 평소에 숨겨져 있고 i 버튼 토글로 열리며, 다시 누르면 닫힌다.
    const overlay = cover.getByTestId('pdf-cover-info-overlay');
    const toggle = cover.getByTestId('pdf-cover-info-toggle');
    await page.mouse.move(2, 2);
    assert.equal(await overlay.isVisible(), false);
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await toggle.click();
    await page.mouse.move(2, 2);
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    await overlay.waitFor({ state: 'visible' });
    assert.equal(await cover.getByTestId('pdf-cover-document-info').innerText(), '문서정보');
    assert.equal(await cover.getByTestId('pdf-cover-document-info').evaluate((element) => getComputedStyle(element).textDecorationLine), 'underline');
    assert.match(await cover.getByTestId('pdf-cover-opened-at').innerText(), /^열린시간: /);
    assert.equal(await cover.getByTestId('pdf-cover-opened-at').innerText(), '열린시간: 2025년 9월 30일');
    assert.match(await cover.getByTestId('pdf-cover-last-page').innerText(), /^최종페이지: /);
    const overlayBox = await overlay.boundingBox();
    assert.ok(Math.abs(overlayBox.y + overlayBox.height - bandBox.y) < 1, '정보 영역은 제목 띠를 제외한 나머지를 덮어야 함');
    await page.screenshot({ path: `${output}/covers-info-${viewport.width}.png`, fullPage: true });
    await toggle.click();
    await page.mouse.move(2, 2);
    await overlay.waitFor({ state: 'hidden' });
    // 마우스를 올리면 토글 없이도 같은 정보가 나온다(포인터 장치 한정).
    if (viewport.width >= 900) {
      await media.hover();
      await overlay.waitFor({ state: 'visible' });
      await page.mouse.move(2, 2);
      await overlay.waitFor({ state: 'hidden' });
    }
    await page.screenshot({ path: `${output}/covers-${viewport.width}.png`, fullPage: true });
    await page.getByTestId('lnb-bookmarks').click();
    await page.waitForURL('**/bookmarks');
    await page.getByRole('heading', { name: '마이클립', exact: true }).waitFor();
    const clipColor = await page.getByTestId('lnb-bookmarks').getByTestId('AttachFileIcon').evaluate((element) => getComputedStyle(element).color);
    const titleClipColor = await page.getByTestId('bookmark-library-page').getByTestId('AttachFileIcon').first().evaluate((element) => getComputedStyle(element).color);
    assert.equal(titleClipColor, clipColor);
    assert.equal(await page.locator('main').evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(255, 255, 255)');
    await page.screenshot({ path: `${output}/clips-${viewport.width}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ viewport, sidebarColor, labels: true, resetRemoved: true, headerGap: 12, countMoved: true, searchNextToAI: true, emptySearch: true, myClips: true, errors }));
    await context.close();
  }
} finally { await browser.close(); }
