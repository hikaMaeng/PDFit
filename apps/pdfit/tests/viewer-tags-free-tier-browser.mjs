import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15201';
const output = new URL('../tests/reports/viewer-tags-free-tier/20260929_000000/', import.meta.url);
await mkdir(output, { recursive: true });
const paletteOutput = new URL('../tests/reports/light-theme-choices/20260930_000000/', import.meta.url);
await mkdir(paletteOutput, { recursive: true });

const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const now = '2026-09-29T00:00:00.000Z';
const colorUpdates = [];
const addedTags = [];
const errors = [];
const automaticTagRequests = [];
const selectionMoveRequests = [];
const selectionDeleteRequests = [];
let paidCoverFixture = false;
let selectionFixture = false;
let scrollFixture = false;
const scrollPdfs = Array.from({ length: 36 }, (_, index) => ({ driveFileId: `scroll-file-${index}`, parentFolderId: 'folder-1', name: `스크롤 문서 ${String(index + 1).padStart(2, '0')}.pdf`, mimeType: 'application/pdf', size: pdfBytes.length, md5Checksum: '', driveVersion: '1', createdTime: now, modifiedTime: now, trashed: false, updatedAt: now }));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: 'ko-KR', colorScheme: 'dark', viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => {
  if (!localStorage.getItem('pdfit.language')) localStorage.setItem('pdfit.language', 'ko');
  if (!localStorage.getItem('pdfit.color-mode')) localStorage.setItem('pdfit.color-mode', 'dark');
});
let page = await context.newPage();
page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
page.on('pageerror', (error) => errors.push(`page: ${error.message}`));

const fulfillJson = (route, value) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
await context.route(`${origin}/api/**`, async (route) => {
  const url = new URL(route.request().url());
  const pathname = url.pathname;
  if (pathname === '/api/events') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: ready\n\n' });
  if (pathname === '/api/auth/me') return fulfillJson(route, {
    authenticated: true,
    user: { id: scrollFixture ? 'scroll-test-user' : selectionFixture ? 'selection-test-user' : paidCoverFixture ? 'paid-tag-test-user' : 'tag-test-user', email: 'test@example.com', name: 'Test User', picture: null },
    subscription: { status: paidCoverFixture ? 'active' : 'trial', access: true, priceKrw: 12000, trialEndsAt: now, currentPeriodEndsAt: paidCoverFixture ? '2027-01-01T00:00:00.000Z' : null, cancelAtPeriodEnd: false, nextBillingAt: null, trialDaysRemaining: 20, earlyPurchaseBonusDays: 0 },
  });
  if (pathname === '/api/folders/cache') return fulfillJson(route, {
    libraryInstanceId: selectionFixture ? 'selected-tag-library-test' : paidCoverFixture ? 'paid-tag-library-test' : 'tag-library-test', schemaVersion: '1', hydratedAt: now,
    snapshot: {
      system: [],
      folders: [{ driveFolderId: 'folder-1', parentFolderId: 'root', name: 'PDFit Library', color: '#3b82f6', isRoot: true, trashed: false, createdAt: now, updatedAt: now }, { driveFolderId: 'folder-2', parentFolderId: 'root', name: '대상폴더', color: '#3b82f6', isRoot: false, trashed: false, createdAt: now, updatedAt: now }],
      pdfs: [{ driveFileId: 'file-1', parentFolderId: 'folder-1', name: '태그 테스트.pdf', mimeType: 'application/pdf', size: pdfBytes.length, md5Checksum: '', driveVersion: '1', createdTime: now, modifiedTime: now, trashed: false, updatedAt: now }, ...(selectionFixture ? [{ driveFileId: 'file-2', parentFolderId: 'folder-1', name: '두번째.pdf', mimeType: 'application/pdf', size: pdfBytes.length, md5Checksum: '', driveVersion: '1', createdTime: now, modifiedTime: now, trashed: false, updatedAt: now }] : []), ...(scrollFixture ? scrollPdfs : [])],
      tags: [{ tagId: 'tag-1', name: '기존태그', color: '#22c55e', createdAt: now, updatedAt: now, deletedAt: '' }],
      pdf_tags: paidCoverFixture && !selectionFixture ? [] : [{ relationId: 'relation-1', driveFileId: 'file-1', tagId: 'tag-1', createdAt: now, updatedAt: now, deletedAt: '' }, ...(scrollFixture ? scrollPdfs.map((pdf, index) => ({ relationId: `scroll-relation-${index}`, driveFileId: pdf.driveFileId, tagId: 'tag-1', createdAt: now, updatedAt: now, deletedAt: '' })) : [])],
      bookmarks: [], reading_progress: [], viewer_state: [{ driveFileId: 'file-1', page: 1, scale: 1, fitMode: 'none', viewMode: 'single', inverted: false, uiHidden: false, scrollTop: 0 }], sync_state: [],
    },
  });
  if (pathname === '/api/folders/move' && route.request().method() === 'POST') {
    const body = JSON.parse(route.request().postData()); selectionMoveRequests.push(body);
    return fulfillJson(route, { ok: true, driveFileId: body.driveFileId });
  }
  if (pathname.includes('/files/') && route.request().method() === 'DELETE') {
    selectionDeleteRequests.push(pathname); return fulfillJson(route, { ok: true });
  }
  if (route.request().method() === 'POST' && pathname.endsWith('/auto')) {
    automaticTagRequests.push(pathname);
    return fulfillJson(route, { folder: 'PDFit Library', processed: 1, failed: 0, addedTags: 1, books: [{ folder: 'PDFit Library', filename: '태그 테스트.pdf', driveFileId: 'file-1', assignedTag: '기존태그', addedTags: ['기존태그'], removedTags: [] }], errors: [] });
  }
  if (route.request().method() === 'PATCH' && pathname.endsWith('/color')) {
    colorUpdates.push(JSON.parse(route.request().postData() ?? '{}'));
    return fulfillJson(route, { ok: true });
  }
  if (route.request().method() === 'POST' && pathname.startsWith('/api/tags/book/')) {
    addedTags.push(JSON.parse(route.request().postData() ?? '{}').tag);
    return fulfillJson(route, { ok: true });
  }
  if (pathname.includes('/files/') || pathname.includes('/by-id/')) return route.fulfill({ status: 200, contentType: 'application/pdf', body: pdfBytes });
  if (pathname.startsWith('/api/viewer-state/')) return fulfillJson(route, { page: 1, scale: 1, fitMode: 'none', viewMode: 'single', inverted: false, uiHidden: false, scrollTop: 0 });
  if (pathname.startsWith('/api/progress/')) return fulfillJson(route, { page: 1 });
  if (pathname.startsWith('/api/bookmarks') || pathname.startsWith('/api/annotations')) return fulfillJson(route, []);
  if (pathname.startsWith('/api/books/') && pathname.endsWith('/metadata')) return fulfillJson(route, null);
  if (pathname === '/api/settings/translations') return fulfillJson(route, { translations: ['PDFit Library'] });
  return fulfillJson(route, []);
});

try {
  await page.goto(`${origin}/folder/PDFit%20Library`, { waitUntil: 'domcontentloaded' });
  await page.getByText('태그 테스트.pdf', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(await page.getByTestId('appearance-toggle').count(), 0, '이전 테마 버튼이 상단에 남아 있음');
  assert.equal(await page.locator('[data-testid="LanguageIcon"]').count(), 0, '이전 언어 버튼이 상단에 남아 있음');
  await page.getByTestId('lnb-preferences').click();
  const preferences = page.getByTestId('preferences-dialog');
  await preferences.getByRole('dialog', { name: '설정' }).waitFor({ state: 'visible' });
  await preferences.getByRole('button', { name: '라이트 모드', exact: true }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('pdfit.color-mode')), 'light');
  assert.equal(await preferences.getByRole('button', { name: '라이트 모드', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: new URL('settings-modal-light.png', output).pathname.slice(1), fullPage: true });
  await preferences.getByTestId('preferences-language').getByRole('combobox').click();
  await page.locator('[role="option"][data-value="en"]').click();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  await preferences.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('lnb-preferences').click();
  await preferences.getByRole('dialog', { name: 'Settings' }).waitFor({ state: 'visible' });
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.equal(await preferences.getByRole('button', { name: 'Light mode', exact: true }).getAttribute('aria-pressed'), 'true', '새로고침 후 테마가 유지되지 않음');
  await page.locator('.pdfit-pdf-row').first().getByTestId('pdf-tag-actions').locator('button').first().waitFor({ state: 'visible' });
  const supportedLanguages = ['zh', 'en', 'es', 'ar', 'hi', 'ru', 'fr', 'pt', 'ms', 'bn', 'ko', 'ja'];
  for (const option of supportedLanguages) {
    await preferences.getByTestId('preferences-language').getByRole('combobox').click();
    assert.equal(await page.getByRole('listbox').getByRole('option').count(), supportedLanguages.length, '언어 목록이 누락됨');
    await page.locator(`[role="option"][data-value="${option}"]`).click();
    assert.equal(await page.locator('html').getAttribute('lang'), option, `${option} 문서 언어가 적용되지 않음`);
    assert.equal(await page.locator('html').getAttribute('dir'), option === 'ar' ? 'rtl' : 'ltr', `${option} 문서 방향이 적용되지 않음`);
    const heading = (await page.getByTestId('pdf-list-header').locator('span').allTextContents())[0];
    assert.equal(heading === '이름', option === 'ko', `${option} 목록 헤더가 선택 언어로 바뀌지 않음`);
    const documentLabel = await page.locator('.pdfit-pdf-row').first().getByTestId('pdf-document-info').getAttribute('aria-label');
    assert.equal(documentLabel === '문서 정보', option === 'ko', `${option} 문서 정보 버튼이 선택 언어로 바뀌지 않음`);
    const managerLabel = await page.locator('.pdfit-pdf-row').first().getByTestId('pdf-tag-actions').locator('button').first().textContent();
    assert.equal(managerLabel === '태그관리', option === 'ko', `${option} 태그관리 버튼이 선택 언어로 바뀌지 않음`);
  }
  await preferences.getByTestId('preferences-language').getByRole('combobox').click();
  await page.locator('[role="option"][data-value="en"]').click();
  await preferences.getByRole('button', { name: 'Dark mode', exact: true }).click();
  await preferences.getByTestId('preferences-language').getByRole('combobox').click();
  await page.locator('[role="option"][data-value="ko"]').click();
  await page.getByRole('listbox').waitFor({ state: 'hidden' });
  await page.screenshot({ path: new URL('settings-modal-dark.png', output).pathname.slice(1), fullPage: true });
  await preferences.getByRole('dialog').screenshot({ path: new URL('settings-dialog.png', output).pathname.slice(1) });
  await preferences.getByRole('button', { name: '닫기', exact: true }).click();
  await preferences.waitFor({ state: 'hidden' });
  const freeAiButton = page.getByTestId('ai-auto-tag-all');
  assert.equal(await freeAiButton.textContent(), 'AI 자동 태그');
  assert.equal(await freeAiButton.isDisabled(), false, '무료 소진 안내 버튼을 클릭할 수 없음');
  await freeAiButton.screenshot({ path: new URL('ai-auto-tag-free-before.png', output).pathname.slice(1) });
  await freeAiButton.click();
  assert.equal(await freeAiButton.textContent(), 'AI 자동 태그 체험판을 소진하였습니다');
  assert.equal(await freeAiButton.isDisabled(), true, '무료 클릭 후 버튼이 비활성화되지 않음');
  for (let attempt = 0; attempt < 20 && await freeAiButton.evaluate((element) => getComputedStyle(element).color) !== 'rgb(111, 114, 120)'; attempt += 1) await page.waitForTimeout(50);
  const freeDisabledColor = await freeAiButton.evaluate((element) => getComputedStyle(element).color);
  const freeDisabledIconColor = await freeAiButton.locator('svg').evaluate((element) => getComputedStyle(element).color);
  assert.equal(freeDisabledIconColor, freeDisabledColor, '무료 소진 후 아이콘이 회색으로 바뀌지 않음');
  assert.equal(freeDisabledColor, 'rgb(111, 114, 120)', '다크모드 무료 소진 버튼이 회색이 아님');
  assert.equal(await page.getByRole('dialog').count(), 0, '무료 클릭에서 유료 실행 확인창이 열림');
  assert.deepEqual(automaticTagRequests, [], '무료 클릭이 AI 요청을 실행함');
  await page.mouse.move(1400, 850);
  await freeAiButton.screenshot({ path: new URL('ai-auto-tag-free-exhausted.png', output).pathname.slice(1) });
  await page.getByTestId('lnb-preferences').click();
  await preferences.getByRole('button', { name: '라이트 모드', exact: true }).click();
  await preferences.getByRole('button', { name: '닫기', exact: true }).click();
  for (let attempt = 0; attempt < 20 && await freeAiButton.evaluate((element) => getComputedStyle(element).color) !== 'rgb(138, 160, 178)'; attempt += 1) await page.waitForTimeout(50);
  const freeLightDisabledColor = await freeAiButton.evaluate((element) => getComputedStyle(element).color);
  assert.equal(freeLightDisabledColor, 'rgb(138, 160, 178)', '라이트모드 무료 소진 버튼 색상이 테마와 다름');
  assert.equal(await freeAiButton.isDisabled(), true);
  assert.equal(await page.locator('body').evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(229, 243, 255)', '라이트 모드 바탕에 D안 하늘색 톤이 적용되지 않음');
  assert.equal(await page.locator('.MuiDrawer-paper').evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(32, 78, 121)', '라이트 모드 왼쪽 메뉴에 D안 딥 블루 색상이 적용되지 않음');
  await page.screenshot({ path: new URL('library-light-deep-blue-palette.png', output).pathname.slice(1) });
  await page.getByTestId('lnb-preferences').click();
  await preferences.getByRole('button', { name: '다크 모드', exact: true }).click();
  await preferences.getByRole('button', { name: '닫기', exact: true }).click();
  assert.equal(await page.getByTestId('pdf-ai-auto-tag').count(), 0, '무료 버전에 개별 PDF 분류가 표시됨');

  const row = page.locator('.pdfit-pdf-row').first();
  assert.equal(await page.getByTestId('pdf-search-input').count(), 0, '검색창이 클릭 전부터 표시됨');
  assert.equal(await page.getByTestId('pdf-search-button').textContent(), '검색');
  await page.getByTestId('pdf-search-button').click();
  await page.getByTestId('pdf-search-input').waitFor({ state: 'visible' });
  assert.equal(await page.getByTestId('pdf-search-input').evaluate((element) => document.activeElement === element), true, '검색 열기 후 입력 포커스 없음');
  assert.equal(await page.getByTestId('pdf-search-input').getAttribute('placeholder'), '검색');
  await page.getByTestId('pdf-search-input').fill('존재하지 않는 검색어');
  assert.equal(await page.locator('.pdfit-pdf-row').count(), 0, '검색 필터 동작 오류');
  await page.getByRole('button', { name: '검색 닫기', exact: true }).click();
  await row.waitFor({ state: 'visible' });
  assert.equal(await page.getByTestId('pdf-search-input').count(), 0);
  await page.getByTestId('pdf-search-button').click();
  await page.getByTestId('pdf-search-input').press('Escape');
  assert.equal(await page.getByTestId('pdf-search-input').count(), 0, 'Escape로 검색창이 닫히지 않음');
  await row.getByTestId('pdf-tag-chip').waitFor({ state: 'visible' });
  const compactTagAppearance = await row.getByTestId('pdf-tag-chip').evaluate((element) => ({
    fontSize: getComputedStyle(element).fontSize,
    height: element.getBoundingClientRect().height,
  }));
  assert.equal(compactTagAppearance.fontSize, '12px', '목록 태그 글자가 커지지 않음');
  assert.equal(compactTagAppearance.height, 22, '태그 글자와 칩 높이가 맞지 않음');
  assert.equal(await row.getByTestId('pdf-list-tags').getByRole('button', { name: '태그관리', exact: true }).count(), 1, '태그관리가 태그 열에 없음');
  assert.equal(await row.locator('.pdfit-row-actions .pdfit-row-action-tags').count(), 0, '태그 관리가 이전 위치에 남아 있음');
  const headerActions = page.getByTestId('folder-header-actions');
  assert.deepEqual(await headerActions.getByRole('button').allTextContents(), ['업로드', '새로고침', '폴더 내 모든 태그 해제'], '상단 폴더 작업 버튼 순서·레이블 오류');
  assert.equal(await headerActions.getByTestId('clear-folder-tags').getByTestId('LocalOfferIcon').count(), 1, '태그 해제 아이콘이 일반 태그 모양이 아님');
  assert.equal(await page.getByTestId('clear-folder-tags').getByTestId('LabelOffIcon').count(), 0, '사선 태그 아이콘이 남아 있음');
  assert.equal(await page.getByTestId('folder-list-toolbar').getByTestId('upload-pdf').count(), 0, '업로드가 이전 도구 모음 위치에 남아 있음');
  assert.equal(await page.getByTestId('folder-list-toolbar').getByTestId('refresh-folder').count(), 0);
  assert.equal(await page.getByTestId('folder-list-toolbar').getByTestId('clear-folder-tags').count(), 0);
  const [actionsBox, toolbarBox] = await Promise.all([headerActions.boundingBox(), page.getByTestId('folder-list-toolbar').boundingBox()]);
  assert.ok(actionsBox && toolbarBox && actionsBox.y + actionsBox.height <= toolbarBox.y, '작업 버튼이 도구 모음 위로 이동하지 않음');
  await headerActions.screenshot({ path: new URL('folder-header-labeled-actions.png', output).pathname.slice(1) });
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('upload-pdf').click();
  const fileChooser = await fileChooserPromise;
  assert.ok(fileChooser.isMultiple(), '업로드 파일 선택 연결이 끊김');
  await page.getByTestId('clear-folder-tags').click();
  const clearTagsDialog = page.getByRole('dialog');
  await clearTagsDialog.waitFor({ state: 'visible' });
  assert.equal(await clearTagsDialog.getByTestId('LabelOffIcon').count(), 0);
  assert.equal(await clearTagsDialog.getByTestId('LocalOfferIcon').count(), 2);
  assert.ok((await clearTagsDialog.innerText()).includes('이 폴더의 문서 1개에 연결된 태그 1개를 모두 해제할까요?'));
  assert.doesNotMatch(await clearTagsDialog.innerText(), /PDF/);
  await page.waitForTimeout(200);
  await clearTagsDialog.screenshot({ path: new URL('clear-folder-tags-document-wording.png', output).pathname.slice(1) });
  await clearTagsDialog.getByRole('button', { name: '취소', exact: true }).click();
  await clearTagsDialog.waitFor({ state: 'hidden' });
  const listHeader = page.getByTestId('pdf-list-header');
  assert.deepEqual(await listHeader.locator('span').allTextContents(), ['이름', '열린시간', '태그', '파일 크기']);
  assert.equal(await page.getByText('1개', { exact: true }).count(), 2, '폴더 개수에서 PDF 문구가 제거되지 않음');
  assert.deepEqual(await page.getByTestId('folder-title-summary').locator('.MuiChip-label').allTextContents(), ['1개'], '폴더 제목 옆 총 용량이 제거되지 않음');
  assert.equal(await page.getByTestId('folder-title-summary').locator('.MuiChip-root').evaluate((element) => getComputedStyle(element).borderRadius), '4px', '문서 개수 배지가 사각형으로 바뀌지 않음');
  assert.equal(await page.getByTestId('folder-title-row').evaluate((element) => getComputedStyle(element).columnGap), '8px', '폴더 아이콘·제목 간격이 줄지 않음');
  const filenameStart = await row.locator('a').first().boundingBox();
  const checkboxBounds = await row.getByTestId('pdf-selection-checkbox').boundingBox();
  assert.ok(Math.abs(filenameStart.x - checkboxBounds.x - checkboxBounds.width - 16) < 1, '체크박스·파일명 간격이 16px로 줄지 않음');
  const sizeHeading = await page.getByTestId('pdf-file-size-header').boundingBox();
  const fileSizeCell = await row.getByTestId('pdf-file-size').boundingBox();
  const infoButton = await row.getByTestId('pdf-document-info').boundingBox();
  assert.ok(Math.abs(sizeHeading.x + sizeHeading.width / 2 - fileSizeCell.x - fileSizeCell.width / 2) < 1, '파일 크기가 헤더 아래에 정렬되지 않음');
  const columnHeadings = await listHeader.locator('span').evaluateAll((elements) => elements.slice(1).map((element) => {
    const rect = element.getBoundingClientRect(); return { x: rect.x, width: rect.width, align: getComputedStyle(element).textAlign };
  }));
  assert.ok(Math.abs(columnHeadings[1].x - columnHeadings[0].x - (columnHeadings[2].x - columnHeadings[1].x)) < 1, '열린시간·태그·파일 크기 열 간격이 다름');
  assert.ok(Math.max(...columnHeadings.map((heading) => heading.width)) - Math.min(...columnHeadings.map((heading) => heading.width)) < 1, '열린시간·태그·파일 크기 열 폭이 다름');
  assert.ok(columnHeadings.every((heading) => heading.align === 'center'), '열 제목이 영역 중앙에 정렬되지 않음');
  assert.equal(await row.getByTestId('pdf-opened-at').evaluate((element) => getComputedStyle(element).textAlign), 'center', '열린시간이 영역 중앙에 있지 않음');
  assert.equal(await row.getByTestId('pdf-file-size').evaluate((element) => getComputedStyle(element).textAlign), 'center', '파일 크기가 영역 중앙에 있지 않음');
  assert.equal(await row.getByTestId('pdf-tag-values').evaluate((element) => getComputedStyle(element).justifyContent), 'center', '태그가 영역 중앙에 있지 않음');
  assert.equal(await row.getByTestId('pdf-tag-actions').evaluate((element) => getComputedStyle(element).justifyContent), 'center', '태그 작업이 영역 중앙에 있지 않음');
  assert.equal(await row.getByTestId('pdf-document-info').textContent(), '');
  assert.equal(await row.getByTestId('pdf-document-info').getAttribute('aria-label'), '문서 정보');
  assert.equal(await row.getByTestId('pdf-document-info').locator('svg').count(), 1);
  const infoAppearance = await row.getByTestId('pdf-document-info').evaluate((element) => {
    const info = getComputedStyle(element);
    const filename = getComputedStyle(element.parentElement.querySelector('a'));
    return { color: info.color, filenameColor: filename.color, background: info.backgroundColor, borderWidth: info.borderTopWidth };
  });
  assert.notEqual(infoAppearance.color, infoAppearance.filenameColor, '문서 정보가 파일명과 같은 색상임');
  assert.equal(infoAppearance.background, 'rgba(0, 0, 0, 0)', '문서 정보 아이콘 뒤에 박스 배경이 남아 있음');
  assert.equal(infoAppearance.borderWidth, '0px', '문서 정보 아이콘에 테두리 박스가 남아 있음');
  assert.ok(Math.abs(infoButton.x - filenameStart.x - filenameStart.width - 4) < 1, '문서 정보 버튼이 파일명 바로 옆에 배치되지 않음');
  assert.equal(await row.getByTestId('pdf-filename-line').getByTestId('pdf-file-size').count(), 0);
  await row.getByTestId('pdf-document-info').click();
  await page.getByRole('dialog').getByLabel('제목', { exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('dialog').getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByTestId('folder-title-summary').locator('..').screenshot({ path: new URL('folder-count-rectangle.png', output).pathname.slice(1) });
  assert.ok((await row.innerText()).includes(`${pdfBytes.length} B`), '개별 문서 용량까지 제거됨');
  assert.equal(await row.locator('[data-testid="PictureAsPdfIcon"]').count(), 0);
  assert.doesNotMatch(await row.innerText(), /수정/);
  assert.equal(await row.getByTestId('pdf-opened-at').textContent(), '—');
  await page.screenshot({ path: new URL('list-centered-columns-document-info.png', output).pathname.slice(1) });
  assert.equal(await row.locator('.MuiChip-deleteIcon').count(), 0, '문서 목록 태그에 ×가 남아 있음');
  assert.equal(await page.getByTestId('lnb-folders-section').getByText('폴더', { exact: true }).count(), 0);
  assert.equal(await page.getByTestId('lnb-folders-section').locator('[data-testid="FolderIcon"]').count(), 1);
  assert.equal(await page.getByTestId('lnb-tags-section').getByText('태그', { exact: true }).count(), 0);
  assert.equal(await page.getByTestId('lnb-tags-section').locator('[data-testid="LocalOfferIcon"]').count(), 1);
  const sectionColors = await Promise.all([['lnb-folders-section', 'FolderIcon'], ['lnb-tags-section', 'LocalOfferIcon']].map(([id, icon]) => page.getByTestId(id).getByTestId(icon).evaluate((element) => getComputedStyle(element).color)));
  assert.deepEqual(sectionColors, ['rgb(59, 130, 246)', 'rgb(59, 130, 246)']);
  const sidebarOrder = await page.locator('.MuiDrawer-paper').evaluate((drawer) => Array.from(drawer.querySelectorAll('[data-testid="lnb-tags-section"], [data-testid="lnb-folders-section"], [data-testid="lnb-bookmarks"]')).map((element) => element.getAttribute('data-testid')));
  assert.deepEqual(sidebarOrder, ['lnb-tags-section', 'lnb-folders-section', 'lnb-bookmarks'], '왼쪽 메뉴가 태그 → 폴더 → 북마크 순서가 아님');
  for (const sectionId of ['lnb-tags-section', 'lnb-folders-section']) {
    const section = page.getByTestId(sectionId);
    await section.click();
    assert.equal(await section.getAttribute('aria-expanded'), 'false', `${sectionId} 접기가 동작하지 않음`);
    await section.click();
    assert.equal(await section.getAttribute('aria-expanded'), 'true', `${sectionId} 펼치기가 동작하지 않음`);
  }
  await page.locator('.MuiDrawer-paper').screenshot({ path: new URL('sidebar-section-icons-blue.png', output).pathname.slice(1) });
  assert.equal(await page.getByTestId('lnb-folder-row').locator('[data-testid="FolderIcon"]').count(), 0, '폴더 항목에 아이콘이 남아 있음');
  assert.equal(await page.locator('.pdfit-tag-row').locator('.MuiListItemIcon-root').count(), 0, '태그 항목에 아이콘이 남아 있음');

  await row.getByTestId('pdf-tag-chip').click();
  await page.waitForURL(`**/tag/${encodeURIComponent('기존태그')}`);
  await page.locator('.pdfit-tag-row .Mui-selected').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.pdfit-tag-row .Mui-selected').count(), 1, '목록 태그 클릭이 LNB 태그 선택에 반영되지 않음');
  const tagCheckbox = row.getByTestId('pdf-selection-checkbox');
  await tagCheckbox.waitFor({ state: 'visible' });
  await page.mouse.move(1400, 850);
  assert.equal(await tagCheckbox.evaluate((element) => getComputedStyle(element).opacity), '1');
  await tagCheckbox.check();
  assert.equal(await page.getByTestId('move-selected-pdfs').count(), 1);
  assert.equal(await page.getByTestId('delete-selected-pdfs').count(), 1);
  assert.equal(await row.getAttribute('data-selected'), 'true');
  await page.getByTestId('pdf-select-all').getByRole('checkbox').uncheck();
  assert.equal(await tagCheckbox.isChecked(), false);
  await page.getByTestId('pdf-select-all').getByRole('checkbox').check();
  assert.equal(await tagCheckbox.isChecked(), true);
  await tagCheckbox.uncheck();
  assert.equal(await page.getByTestId('move-selected-pdfs').count(), 0);
  await page.mouse.move(1400, 850);
  await page.screenshot({ path: new URL('tag-list-checkbox-visible.png', output).pathname.slice(1), fullPage: true });
  await page.goto(`${origin}/folder/PDFit%20Library`, { waitUntil: 'domcontentloaded' });
  await row.getByTestId('pdf-tag-chip').waitFor({ state: 'visible' });

  const popupPromise = page.waitForEvent('popup');
  await row.getByRole('link', { name: '태그 테스트.pdf', exact: true }).click();
  const viewerPopup = await popupPromise;
  await viewerPopup.getByLabel('페이지 번호').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('[data-testid="pdf-opened-at"]')?.getAttribute('datetime'));
  const openedAt = await row.getByTestId('pdf-opened-at').getAttribute('datetime');
  assert.ok(openedAt && Math.abs(Date.now() - Date.parse(openedAt)) < 10000, '실제 열린시간이 표시되지 않음');
  await viewerPopup.close();
  await page.mouse.move(1400, 850);
  const checkbox = row.getByTestId('pdf-selection-checkbox');
  assert.equal(await page.getByTestId('move-selected-pdfs').count(), 0);
  assert.equal(await page.getByTestId('delete-selected-pdfs').count(), 0);
  assert.equal(await row.locator('.pdfit-row-action-move, .pdfit-row-action-delete').count(), 0, '이동·삭제가 행 오른쪽에 남아 있음');
  assert.equal(await checkbox.evaluate((element) => getComputedStyle(element).opacity), '1', '호버 전 체크박스가 보이지 않음');
  assert.equal(await checkbox.evaluate((element) => getComputedStyle(element).pointerEvents), 'auto');
  await checkbox.check();
  await page.getByTestId('move-selected-pdfs').click();
  await page.getByRole('dialog', { name: '폴더로 이동' }).getByRole('button', { name: '취소', exact: true }).click();
  await page.getByTestId('delete-selected-pdfs').click();
  await page.getByRole('dialog').getByRole('button', { name: '취소', exact: true }).click();
  await page.mouse.move(1400, 850);
  await page.getByTestId('folder-list-toolbar').screenshot({ path: new URL('selection-toolbar-actions.png', output).pathname.slice(1) });
  await checkbox.uncheck();
  assert.equal(await page.getByTestId('delete-selected-pdfs').count(), 0);
  await page.mouse.move(1400, 850);
  await page.screenshot({ path: new URL('list-checkbox-visible.png', output).pathname.slice(1), fullPage: true });
  await row.screenshot({ path: new URL('list-row-checkbox-visible.png', output).pathname.slice(1) });
  await page.screenshot({ path: new URL('document-list-columns.png', output).pathname.slice(1), fullPage: true });
  await page.getByRole('button', { name: '표지 보기', exact: true }).click();
  const cover = page.getByTestId('pdf-cover-card').first();
  const coverCheckbox = cover.getByTestId('pdf-cover-selection');
  await coverCheckbox.waitFor({ state: 'visible' });
  const [cardBox, checkboxBox] = await Promise.all([cover.boundingBox(), coverCheckbox.boundingBox()]);
  assert.ok(cardBox && checkboxBox && checkboxBox.x >= cardBox.x && checkboxBox.y >= cardBox.y && checkboxBox.x + checkboxBox.width <= cardBox.x + cardBox.width && checkboxBox.y + checkboxBox.height <= cardBox.y + cardBox.height, '표지 체크박스가 카드 밖에서 잘림');
  const footerBox = await cover.getByTestId('pdf-cover-actions').boundingBox();
  assert.ok(footerBox && checkboxBox.y >= footerBox.y && checkboxBox.x + checkboxBox.width >= footerBox.x + footerBox.width - 1, '표지 체크박스가 하단 우측에 배치되지 않음');
  await coverCheckbox.getByRole('checkbox').check();
  await coverCheckbox.getByRole('checkbox').uncheck();
  await page.mouse.move(1400, 850);
  await cover.screenshot({ path: new URL('cover-checkbox-contained.png', output).pathname.slice(1) });
  await page.screenshot({ path: new URL('cover-checkbox-bottom-right.png', output).pathname.slice(1), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const [mobileCard, mobileCheckbox] = await Promise.all([cover.boundingBox(), coverCheckbox.boundingBox()]);
  assert.ok(mobileCard && mobileCheckbox && mobileCheckbox.x + mobileCheckbox.width <= mobileCard.x + mobileCard.width && mobileCheckbox.y + mobileCheckbox.height <= mobileCard.y + mobileCard.height, '모바일 표지 체크박스 잘림');
  const mobileFooter = await cover.getByTestId('pdf-cover-actions').boundingBox();
  assert.ok(mobileFooter && mobileCheckbox.y >= mobileFooter.y && mobileCheckbox.x + mobileCheckbox.width >= mobileFooter.x + mobileFooter.width - 1, '모바일 표지 체크박스의 하단 우측 배치 오류');
  await page.getByRole('button', { name: '목록 보기', exact: true }).click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), '모바일 문서 목록이 화면 가로폭을 넘음');
  await page.screenshot({ path: new URL('document-list-mobile.png', output).pathname.slice(1), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);
  assert.equal(await row.getByTestId('pdf-tag-chip').count(), 1, '목록 태그가 공통 형식을 사용하지 않음');
  await row.getByRole('button', { name: '태그관리' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('파일명 : 태그 테스트.pdf', { exact: true }).waitFor({ state: 'visible' });
  const autoClassifyButton = dialog.getByRole('button', { name: 'PDF 자동 분류' });
  await autoClassifyButton.waitFor({ state: 'visible' });
  assert.ok(await autoClassifyButton.isDisabled(), '무료 버전 태그 관리창의 자동 분류 버튼이 활성화됨');
  assert.equal(await dialog.getByTestId('pdf-tag-chip').count(), 1, '관리창 태그가 공통 형식을 사용하지 않음');
  const existingChip = dialog.getByTestId('pdf-tag-chip').first();
  const backgroundBefore = await existingChip.evaluate((element) => getComputedStyle(element).backgroundColor);
  await existingChip.locator('.MuiChip-label').hover();
  await page.waitForTimeout(180);
  const backgroundOnLabel = await existingChip.evaluate((element) => getComputedStyle(element).backgroundColor);
  assert.notEqual(backgroundOnLabel, backgroundBefore, '태그 본문 호버에서 전체 배경이 바뀌지 않음');
  await existingChip.locator('.MuiChip-deleteIcon').hover();
  await page.waitForTimeout(180);
  assert.equal(await existingChip.evaluate((element) => getComputedStyle(element).backgroundColor), backgroundOnLabel, '× 호버에서 태그 전체 강조가 유지되지 않음');
  await page.screenshot({ path: new URL('tag-hover-delete-icon.png', output).pathname.slice(1), fullPage: true });
  await dialog.screenshot({ path: new URL('tag-dialog-hover.png', output).pathname.slice(1) });

  const colorButton = dialog.getByRole('button', { name: '새 태그 색상' });
  const colorSwatch = colorButton.getByTestId('tag-color-swatch');
  assert.equal(await colorButton.locator('[data-testid="LocalOfferIcon"]').count(), 0, '색상 선택 버튼에 태그 아이콘이 남아 있음');
  assert.equal(await colorSwatch.evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(59, 130, 246)', '클릭 전 선택 색상이 동그라미에 표시되지 않음');
  await page.mouse.move(1400, 850);
  await dialog.screenshot({ path: new URL('tag-color-circle-before-click.png', output).pathname.slice(1) });
  await colorButton.click();
  assert.equal(await page.getByTestId('tag-color-option').count(), 25, '확장된 태그 색상 팔레트가 모두 표시되지 않음');
  await page.getByRole('dialog', { name: '새 태그 색상' }).screenshot({ path: new URL('tag-color-palette-expanded.png', output).pathname.slice(1) });
  await page.getByRole('button', { name: '#92400e' }).click();
  await page.getByRole('dialog', { name: '새 태그 색상' }).waitFor({ state: 'hidden' });
  assert.equal(await colorSwatch.evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(146, 64, 14)', '선택한 색상이 동그라미에 반영되지 않음');
  await dialog.screenshot({ path: new URL('tag-color-circle-selected.png', output).pathname.slice(1) });
  await dialog.getByLabel('태그 추가').fill('새태그');
  await dialog.getByLabel('태그 추가').press('Enter');
  await dialog.getByTestId('pdf-tag-chip').filter({ hasText: '새태그' }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="pdf-tag-chip"]').length >= 3);
  for (let attempt = 0; attempt < 50 && colorUpdates.length === 0; attempt += 1) await page.waitForTimeout(100);
  assert.deepEqual(colorUpdates, [{ color: '#92400e' }], '선택한 신규 태그 색상이 저장되지 않음');
  assert.equal(await dialog.getByLabel('태그 추가').inputValue(), '', '추가한 태그가 입력칸에 남아 닫을 때 재추가됨');
  await page.screenshot({ path: new URL('tag-dialog.png', output).pathname.slice(1), fullPage: true });

  await dialog.getByRole('button', { name: '닫기' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.getByText(/이미 추가된 태그입니다/).count(), 0, '닫을 때 잘못된 중복 안내가 표시됨');
  assert.deepEqual(addedTags, ['새태그'], '같은 태그 저장이 반복됨');

  await page.goto(`${origin}/tag/${encodeURIComponent('기존태그')}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.pdfit-pdf-row').first().getByRole('button', { name: '태그관리' }).click();
  await dialog.getByTestId('tag-color-swatch').waitFor({ state: 'visible' });
  await dialog.getByLabel('태그 추가').fill('태그페이지');
  await dialog.getByLabel('태그 추가').press('Enter');
  await dialog.getByTestId('pdf-tag-chip').filter({ hasText: '태그페이지' }).waitFor({ state: 'visible' });
  await dialog.getByRole('button', { name: '닫기' }).waitFor({ state: 'visible' });
  for (let attempt = 0; attempt < 50 && await dialog.getByRole('button', { name: '닫기' }).isDisabled(); attempt += 1) await page.waitForTimeout(100);
  assert.equal(await dialog.getByLabel('태그 추가').inputValue(), '', '태그 화면에서도 추가 후 입력칸이 비워져야 함');
  await dialog.getByRole('button', { name: '닫기' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.getByText(/이미 추가된 태그입니다/).count(), 0);
  assert.deepEqual(addedTags, ['새태그', '태그페이지']);
  await page.goto(`${origin}/viewer/PDFit%20Library/%ED%83%9C%EA%B7%B8%20%ED%85%8C%EC%8A%A4%ED%8A%B8.pdf?driveFileId=file-1`, { waitUntil: 'domcontentloaded' });
  const headerTags = page.getByTestId('viewer-header-tags');
  await headerTags.waitFor({ state: 'visible' });
  assert.deepEqual((await headerTags.getByTestId('pdf-tag-chip').allTextContents()).sort(), ['기존태그', '새태그', '태그페이지']);
  const fileBox = await page.getByText('태그 테스트.pdf', { exact: true }).boundingBox();
  const tagsBox = await headerTags.boundingBox();
  assert.ok(fileBox && tagsBox && tagsBox.x > fileBox.x + fileBox.width, '뷰어 태그가 파일명 오른쪽에 배치되지 않음');
  await page.screenshot({ path: new URL('viewer-header-tags.png', output).pathname.slice(1), fullPage: true });
  paidCoverFixture = true;
  await page.setViewportSize({ width: 930, height: 900 });
  await page.goto(`${origin}/folder/PDFit%20Library`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('ai-auto-tag-all').waitFor({ state: 'visible' });
  const paidAiButton = page.getByTestId('ai-auto-tag-all');
  assert.equal(await paidAiButton.textContent(), 'AI 자동 태그');
  for (let attempt = 0; attempt < 50 && await paidAiButton.isDisabled(); attempt += 1) await page.waitForTimeout(100);
  assert.equal(await paidAiButton.isDisabled(), false, '유료 자동 태그가 활성화되지 않음');
  await paidAiButton.click();
  const paidAiDialog = page.getByRole('dialog', { name: 'AI 자동 태그' });
  await paidAiDialog.waitFor({ state: 'visible' });
  await paidAiDialog.getByRole('button', { name: '취소', exact: true }).click();
  await paidAiDialog.waitFor({ state: 'hidden' });
  assert.deepEqual(automaticTagRequests, [], '취소 또는 무료 안내에서 AI 요청이 실행됨');
  await paidAiButton.click();
  await paidAiDialog.getByRole('button', { name: 'AI 자동 태그', exact: true }).click();
  await paidAiDialog.waitFor({ state: 'hidden' });
  await page.locator('.pdfit-pdf-row').first().getByTestId('pdf-tag-chip').waitFor({ state: 'visible' });
  await page.getByTestId('clear-folder-tags').screenshot({ path: new URL('clear-folder-tags-normal-icon.png', output).pathname.slice(1) });
  assert.equal(automaticTagRequests.length, 1, '유료 자동 태그 요청이 정상 실행되지 않음');
  const paidRowTags = page.locator('.pdfit-pdf-row').first().getByTestId('pdf-list-tags');
  assert.equal(await paidRowTags.getByTestId('pdf-ai-auto-tag').count(), 1, '자동 태그가 태그 열에 없음');
  assert.deepEqual(await paidRowTags.locator(':scope > *').evaluateAll((elements) => elements.map((element) => element.getAttribute('data-testid'))), ['pdf-tag-values', 'pdf-tag-actions']);
  const tagColumnOrder = await paidRowTags.getByTestId('pdf-tag-actions').locator(':scope > button').evaluateAll((elements) => elements.map((element) => element.getAttribute('data-testid') ?? element.className));
  assert.ok(tagColumnOrder[0].includes('pdfit-row-action-tags'));
  assert.equal(tagColumnOrder[1], 'pdf-ai-auto-tag');
  await page.locator('.pdfit-pdf-row').first().screenshot({ path: new URL('tag-column-actions.png', output).pathname.slice(1) });
  await page.getByRole('button', { name: '표지 보기', exact: true }).click();
  const paidCover = page.getByTestId('pdf-cover-card').first();
  const paidActions = paidCover.getByTestId('pdf-cover-actions');
  await paidActions.locator('button').first().waitFor({ state: 'visible' });
  await page.mouse.move(920, 850);
  const actionBoxes = await paidActions.locator('button').evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }));
  assert.equal(actionBoxes.length, 5, '유료 표지의 전체 작업 버튼이 표시되지 않음');
  const paidCheck = await paidCover.getByTestId('pdf-cover-selection').boundingBox();
  assert.ok(paidCheck);
  for (const button of actionBoxes) {
    assert.ok(Math.abs(button.y + button.height / 2 - paidCheck.y - paidCheck.height / 2) < 1, '표지 작업 버튼·체크박스가 일렬이 아님');
    assert.ok(button.x + button.width <= paidCheck.x, '표지 작업 버튼과 체크박스가 겹침');
  }
  const coverActionGaps = [...actionBoxes, paidCheck].slice(1).map((box, index) => box.x - actionBoxes[index].x - actionBoxes[index].width);
  assert.ok(Math.max(...coverActionGaps) - Math.min(...coverActionGaps) < 1, '표지 아이콘·체크박스 사이 간격이 균등하지 않음');
  await paidCover.screenshot({ path: new URL('cover-actions-single-row.png', output).pathname.slice(1) });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const mobileCenters = await paidActions.locator('button, [data-testid="pdf-cover-selection"]').evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect(); return rect.y + rect.height / 2;
  }));
  assert.ok(Math.max(...mobileCenters) - Math.min(...mobileCenters) < 1, '모바일 표지 작업 버튼·체크박스가 일렬이 아님');
  const mobileActionGaps = await paidActions.locator('button, [data-testid="pdf-cover-selection"]').evaluateAll((elements) => elements.slice(1).map((element, index) => element.getBoundingClientRect().left - elements[index].getBoundingClientRect().right));
  assert.ok(Math.max(...mobileActionGaps) - Math.min(...mobileActionGaps) < 1, '모바일 표지 작업 간격이 균등하지 않음');
  scrollFixture = true;
  paidCoverFixture = false;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/folder/PDFit%20Library`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '목록 보기', exact: true }).click();
  assert.equal(await page.locator('.pdfit-pdf-row').count(), 37);
  const palettePage = await context.newPage();
  await palettePage.goto(`${origin}/folder/PDFit%20Library`, { waitUntil: 'domcontentloaded' });
  await palettePage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await palettePage.locator('.pdfit-pdf-row').first().waitFor({ state: 'visible' });
  await palettePage.getByTestId('lnb-preferences').click();
  await palettePage.getByTestId('preferences-dialog').getByRole('button', { name: '라이트 모드', exact: true }).click();
  await palettePage.getByTestId('preferences-dialog').getByRole('button', { name: '닫기', exact: true }).click();
  await palettePage.getByTestId('preferences-dialog').waitFor({ state: 'hidden' });
  const lightChoices = [
    { id: 'A-linen', canvas: '#f0ece5', surface: '#faf7f1', sidebar: '#51443b', selected: '#6a5949', text: '#332d28', line: '#d9d0c3' },
    { id: 'B-ivory', canvas: '#f4f1e9', surface: '#fbf9f4', sidebar: '#3d403b', selected: '#555a51', text: '#30332e', line: '#dcd7cb' },
    { id: 'C-sage', canvas: '#e9eee7', surface: '#f7f9f4', sidebar: '#34483b', selected: '#496352', text: '#29372e', line: '#d1dacd' },
    { id: 'D-rose-sand', canvas: '#f3e9e3', surface: '#fcf7f3', sidebar: '#604440', selected: '#795852', text: '#3b2e2a', line: '#e3d0c8' },
  ];
  for (const choice of lightChoices) {
    const previewStyle = await palettePage.addStyleTag({ content: `
      html, body, #root, main { background-color: ${choice.canvas} !important; color: ${choice.text} !important; }
      [data-testid="library-fixed-controls"] { background-color: ${choice.canvas} !important; }
      .MuiDrawer-paper { background-color: ${choice.sidebar} !important; border-color: ${choice.selected} !important; }
      .MuiDrawer-paper .Mui-selected { background-color: ${choice.selected} !important; }
      .MuiDrawer-paper .MuiDivider-root { border-color: ${choice.selected} !important; }
      .MuiPaper-root:not(.MuiDrawer-paper) { background-color: ${choice.surface} !important; border-color: ${choice.line} !important; }
      .pdfit-pdf-row, [data-testid="pdf-list-header"], [data-testid="folder-list-toolbar"] { border-color: ${choice.line} !important; }
      .MuiDivider-root { border-color: ${choice.line} !important; }
    ` });
    await palettePage.screenshot({ path: new URL(`${choice.id}.png`, paletteOutput).pathname.slice(1) });
    await previewStyle.evaluate((element) => element.remove());
  }
  await palettePage.evaluate(() => localStorage.setItem('pdfit.color-mode', 'dark'));
  await palettePage.close();
  const main = page.locator('main');
  const sidebar = page.locator('.MuiDrawer-paper');
  const sidebarBefore = await sidebar.boundingBox();
  const titleBefore = await page.getByTestId('folder-title-row').boundingBox();
  await main.evaluate((element) => element.scrollTo(0, 650));
  await page.waitForTimeout(100);
  const assertFixedControls = async () => {
    const controls = await page.getByTestId('library-fixed-controls').boundingBox();
    const mainBox = await main.boundingBox();
    const headings = await page.getByTestId('pdf-list-header').boundingBox();
    assert.ok(Math.abs(controls.y - mainBox.y) < 1, `선택 도구 모음이 스크롤 상단에 고정되지 않음: ${JSON.stringify({ controls, mainBox, scrollTop: await main.evaluate((element) => element.scrollTop) })}`);
    assert.ok(headings.y >= controls.y && headings.y + headings.height <= controls.y + controls.height + 1, '열 제목이 고정 도구 모음에서 분리됨');
    assert.ok(await main.evaluate((element) => element.scrollTop) > 400, '문서 목록이 실제로 스크롤되지 않음');
    assert.equal(await page.evaluate(() => window.scrollY), 0, '문서 스크롤이 전체 화면을 움직임');
    assert.notEqual(await page.getByTestId('library-fixed-controls').evaluate((element) => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)', '고정 영역 배경이 투명함');
  };
  await assertFixedControls();
  assert.deepEqual(await sidebar.boundingBox(), sidebarBefore, '문서 스크롤로 왼쪽 메뉴가 움직임');
  assert.ok((await page.getByTestId('folder-title-row').boundingBox()).y < titleBefore.y - 400, '제목까지 고정되어 문서 영역을 차지함');
  await page.screenshot({ path: new URL('folder-fixed-controls-scrolled.png', output).pathname.slice(1) });
  await page.goto(`${origin}/tag/${encodeURIComponent('기존태그')}`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('tag-list-toolbar').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.pdfit-pdf-row').count(), 37);
  assert.equal(await page.getByTestId('tag-title-row').evaluate((element) => getComputedStyle(element).columnGap), '8px');
  const tagTitleSpacing = await page.getByTestId('tag-title-row').evaluate((element) => {
    const icon = element.querySelector('svg').getBoundingClientRect();
    const name = element.querySelector('.MuiTypography-h5').getBoundingClientRect();
    return name.x - icon.right;
  });
  assert.equal(tagTitleSpacing, 8, '태그 아이콘 내부 여백 때문에 폴더와 간격이 다름');
  assert.equal(await page.getByTestId('tag-document-count').evaluate((element) => getComputedStyle(element).borderRadius), '4px');
  assert.equal(await page.getByTestId('tag-document-count').evaluate((element) => getComputedStyle(element).fontWeight), '600');
  assert.equal(await page.getByTestId('pdf-folder-location').count(), 0, '태그 목록의 폴더 표시가 남아 있음');
  const tagFirstRow = page.locator('.pdfit-pdf-row').first();
  const tagNameBox = await tagFirstRow.locator('a').first().boundingBox();
  const tagInfoBox = await tagFirstRow.getByTestId('pdf-document-info').boundingBox();
  assert.ok(Math.abs(tagInfoBox.x - tagNameBox.x - tagNameBox.width - 4) < 1);
  assert.equal(await tagFirstRow.getByTestId('pdf-file-size').textContent(), `${pdfBytes.length} B`);
  assert.equal(await tagFirstRow.getByTestId('pdf-document-info').getAttribute('aria-label'), '문서 정보');
  await page.locator('.pdfit-pdf-row').first().getByTestId('pdf-document-info').click();
  await page.getByRole('dialog').getByLabel('제목', { exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('dialog').getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByTestId('pdf-selection-checkbox').nth(0).check();
  await page.getByTestId('pdf-selection-checkbox').nth(1).check();
  assert.equal(await page.getByTestId('selected-document-count').textContent(), '2개 선택됨');
  assert.equal(await page.getByTestId('selected-document-count').locator('.MuiChip-root').count(), 0);
  assert.equal(await page.getByTestId('move-selected-pdfs').textContent(), '폴더 이동');
  assert.equal(await page.getByTestId('delete-selected-pdfs').textContent(), '삭제');
  await main.evaluate((element) => element.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.screenshot({ path: new URL('tag-list-title-info-selected.png', output).pathname.slice(1) });
  await main.evaluate((element) => element.scrollTo(0, 650));
  await page.waitForTimeout(100);
  await assertFixedControls();
  assert.deepEqual(await sidebar.boundingBox(), sidebarBefore);
  await page.screenshot({ path: new URL('tag-fixed-controls-selected.png', output).pathname.slice(1) });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  await assertFixedControls();
  assert.ok(await main.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), '모바일 선택 레이블이 가로로 넘침');
  await page.screenshot({ path: new URL('tag-fixed-controls-mobile.png', output).pathname.slice(1) });
  scrollFixture = false;
  paidCoverFixture = true;
  selectionFixture = true;
  await page.close();
  page = await context.newPage();
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/folder/PDFit%20Library`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '목록 보기', exact: true }).click();
  await page.getByText('두번째.pdf', { exact: true }).waitFor({ state: 'visible' });
  const alignmentRows = page.locator('.pdfit-pdf-row');
  const taggedRow = alignmentRows.filter({ hasText: '태그 테스트.pdf' });
  const untaggedRow = alignmentRows.filter({ hasText: '두번째.pdf' });
  await taggedRow.getByTestId('pdf-tag-chip').waitFor({ state: 'visible' });
  assert.equal(await taggedRow.getByTestId('pdf-tag-chip').count(), 1, '태그 테스트 문서에 태그가 없음');
  assert.equal(await untaggedRow.getByTestId('pdf-tag-chip').count(), 0, '두 번째 문서에 태그가 없어야 함');
  const alignment = await alignmentRows.evaluateAll((elements) => elements.map((element) => {
    const tag = element.querySelector('[data-testid="pdf-tag-actions"]');
    const button = tag.querySelector('.pdfit-row-action-tags');
    const ai = tag.querySelector('.pdfit-row-action-ai');
    const tagRect = tag.getBoundingClientRect();
    const managerRect = button.getBoundingClientRect();
    const chipRect = element.querySelector('[data-testid="pdf-tag-chip"]')?.getBoundingClientRect();
    return { tagX: tagRect.x, manageX: managerRect.x, manageRight: managerRect.right, aiX: ai?.getBoundingClientRect().x ?? null, chipToManageGap: chipRect ? managerRect.x - chipRect.right : null, label: button.textContent, decoration: getComputedStyle(button).textDecorationLine };
  }));
  assert.ok(Math.abs(alignment[0].tagX - alignment[1].tagX) < 1, '태그 유무에 따라 작업 영역 위치가 달라짐');
  assert.ok(Math.abs(alignment[0].manageX - alignment[1].manageX) < 1, '태그 유무에 따라 태그관리 위치가 달라짐');
  assert.ok(alignment.every((entry) => entry.aiX !== null), '유료 문서의 AI 버튼이 누락됨');
  assert.ok(Math.abs(alignment[0].aiX - alignment[1].aiX) < 1, '태그 유무에 따라 AI 버튼 위치가 달라짐');
  const chipToManageGap = alignment.find((entry) => entry.chipToManageGap !== null)?.chipToManageGap;
  assert.ok(chipToManageGap >= 16 && chipToManageGap <= 36, `태그와 태그관리 사이 간격이 요청한 크기와 다름: ${chipToManageGap}px`);
  assert.deepEqual(alignment.map((entry) => entry.label), ['태그관리', '태그관리']);
  assert.ok(alignment.every((entry) => entry.decoration.includes('underline')), '태그관리 밑줄이 없음');
  await page.screenshot({ path: new URL('tag-actions-aligned-with-and-without-tag.png', output).pathname.slice(1) });
  await page.getByTestId('pdf-select-all').getByRole('checkbox').check();
  assert.equal(await page.getByTestId('selected-document-count').textContent(), '2개 선택됨');
  assert.equal(await page.getByTestId('move-selected-pdfs').textContent(), '폴더 이동');
  assert.equal(await page.getByTestId('delete-selected-pdfs').textContent(), '삭제');
  await page.getByTestId('move-selected-pdfs').click();
  const batchMoveDialog = page.getByRole('dialog', { name: '폴더로 이동' });
  await batchMoveDialog.getByRole('combobox').click();
  await page.getByRole('option', { name: '대상폴더', exact: true }).click();
  await batchMoveDialog.getByRole('button', { name: '이동', exact: true }).click();
  await batchMoveDialog.waitFor({ state: 'hidden' });
  for (let attempt = 0; attempt < 40 && selectionMoveRequests.length < 2; attempt += 1) await page.waitForTimeout(50);
  assert.equal(selectionMoveRequests.length, 2, '전체 선택 이동이 모든 문서에 적용되지 않음');
  assert.ok(selectionMoveRequests.every((request) => request.toFolder === '대상폴더'));
  await page.goto(`${origin}/folder/${encodeURIComponent('대상폴더')}`, { waitUntil: 'domcontentloaded' });
  await page.getByText('두번째.pdf', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(await page.locator('.pdfit-pdf-row').count(), 2);
  assert.equal(await page.getByTestId('folder-list-toolbar').getByRole('button', { name: '폴더 삭제', exact: true }).count(), 0);
  assert.equal(await page.getByTestId('folder-list-toolbar').getByTestId('DeleteIcon').count(), 0, 'AI 자동 태그 옆 폴더 휴지통이 남아 있음');
  await page.getByTestId('lnb-folder-row').filter({ hasText: '대상폴더' }).locator('button').last().click();
  await page.getByRole('dialog').getByText('폴더 "대상폴더"와 폴더 안의 모든 문서를 삭제할까요?', { exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('dialog').getByRole('button', { name: '취소', exact: true }).click();
  await page.getByTestId('pdf-select-all').getByRole('checkbox').check();
  await page.getByTestId('delete-selected-pdfs').click();
  await page.getByRole('dialog').getByRole('button', { name: '삭제', exact: true }).click();
  for (let attempt = 0; attempt < 40 && selectionDeleteRequests.length < 2; attempt += 1) await page.waitForTimeout(50);
  assert.equal(selectionDeleteRequests.length, 2, '전체 선택 삭제가 모든 문서에 적용되지 않음');
  assert.equal(await page.getByTestId('delete-selected-pdfs').count(), 0);
  await page.getByTestId('lnb-bookmarks').click();
  await page.waitForURL('**/bookmarks');
  await page.locator('[data-testid="lnb-bookmarks"].Mui-selected').waitFor({ state: 'visible' });
  if (errors.length) throw new Error(errors.join(' | '));
  await writeFile(new URL('result.json', output), JSON.stringify({
    headerActionsOrder: ['업로드', '새로고침', '폴더 내 모든 태그 해제'], headerActionsAboveToolbar: true, uploadFileChooser: true,
    clearFolderTagsConfirmation: true, clearFolderTagsStandardIcon: true, clearFolderTagsDocumentWording: true,
    freeBulkTagExhaustedNotice: true, freeBulkTagDisabledAfterClick: true, freeDisabledColor, freeLightDisabledColor,
    automaticTagRequests, paidAutoTagWorks: true, sidebarSectionIconsBlue: true, folderTitleGap: '8px', tagTitleGap: '8px',
    folderAndTagCountStyleMatches: true, checkboxFilenameGap: '16px', fixedFolderControls: true, fixedTagControls: true,
    sidebarPositionUnchanged: true, mobileFixedControls: true, selectedCountPlainText: '2개 선택됨', selectionActionLabels: ['폴더 이동', '삭제'],
    folderToolbarTrashRemoved: true, fileSizeColumnAligned: true, detailColumnsEqualSpacing: true, detailColumnsEqualWidth: true, documentInfoLabel: true, documentInfoBesideFilename: true, tagFolderLocationRemoved: true, folderDocumentInfoDialog: true, tagDocumentInfoDialog: true, tagActionsAlignedWithAndWithoutTag: alignment,
    selectionMoveRequests, selectionDeleteRequests, freeDialogClassificationDisabled: true, filenameLabel: true,
    createdTagColor: colorUpdates[0]?.color, tagColorCircleBeforeClick: true, tagColorCircleUpdates: true,
    viewerTags: ['기존태그', '새태그', '태그페이지'], commonTagChip: true, checkboxAlwaysVisible: true, tagHoverOnLabelAndDelete: true,
    listHeaders: ['이름', '열린시간', '태그', '파일 크기'], openedAt, pdfIconRemoved: true, modifiedTextRemoved: true,
    tagNavigatesToLnb: true, coverCheckboxContained: true, coverCheckboxBottomRight: true, coverActionsSingleRow: true, coverActionsEqualSpacing: true,
    tagListCheckboxSelection: true, preferencesModal: true, languageAndThemePersistAfterReload: true, sidebarItemIconsRemoved: true,
    mobileNoOverflow: true, sidebarSectionIcons: true, addedTags, duplicateNoticeAfterClose: false, errors,
  }, null, 2));
  console.log('PASS viewer tags and free-tier browser test');
} finally {
  await browser.close();
}
