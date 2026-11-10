import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const baseUrl = process.env.PDFIT_TEST_BASE_URL ?? 'http://localhost:15203';
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(testDirectory, 'reports', 'tag-count-clarity', '20260916_000000');
await mkdir(output, { recursive: true });
const errors = [];
let expectClearFailure = false;
let folderAutoTagRequests = 0;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1380, height: 720 } });
page.on('console', (message) => {
  if (message.type() === 'error' && !(expectClearFailure && message.text().includes('status of 500'))) errors.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
await page.addInitScript(() => {
  localStorage.setItem('pdfit.language', 'ko');
  localStorage.setItem('pdfit.color-mode', 'dark');
});
const tags = [
  ['경제·경영', 2, '#65a30d'], ['과학', 1, '#db2777'], ['글쓰기', 1, '#dc2626'],
  ['디자인', 5, '#ca8a04'], ['마케팅', 1, '#dc2626'], ['소프트웨어', 2, '#059669'],
  ['심리학', 3, '#ea580c'], ['운영체제', 2, '#0284c7'], ['웹 개발', 1, '#0891b2'],
  ['인공지능', 2, '#7c3aed'], ['자기계발', 1, '#65a30d'], ['창업', 2, '#059669'],
  ['투자·재테크', 1, '#16a34a'], ['프로그래밍', 4, '#2563eb'], ['UI·UX', 11, '#0284c7'],
].map(([name, bookCount, color]) => ({ name, bookCount, color }));
const files = [
  { name: '올바른 소프트웨어 설계.pdf', driveFileId: 'drive-book-a', size: 73400320, modifiedAt: '2026-08-24T05:00:00.000Z' },
  { name: '올바른 소프트웨어 설계.pdf', driveFileId: 'drive-book-b', size: 73400320, modifiedAt: '2026-09-10T05:00:00.000Z' },
];
const clearedFolders = [];
const changedTagColors = [];
let failNextFolderClear = true;
await page.route('**/api/**', async (route) => {
  const url = new URL(route.request().url());
  const pathname = url.pathname;
  if (pathname === '/api/events') {
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: ready\n\n' });
    return;
  }
  if (route.request().method() === 'DELETE' && pathname.startsWith('/api/tags/folder/')) {
    clearedFolders.push(pathname);
    if (failNextFolderClear) {
      failNextFolderClear = false;
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'test failure' }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, removed: 2 }) });
    return;
  }
  if (route.request().method() === 'PATCH' && pathname.endsWith('/color')) {
    const color = JSON.parse(route.request().postData() ?? '{}').color;
    const tagName = decodeURIComponent(pathname.split('/')[3] ?? '');
    changedTagColors.push(color);
    await new Promise((resolve) => setTimeout(resolve, 450));
    const target = tags.find((tag) => tag.name === tagName);
    if (target) target.color = color;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    return;
  }
  if (route.request().method() === 'POST' && pathname.endsWith('/auto') && pathname.startsWith('/api/tags/folder/')) {
    folderAutoTagRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 450));
    if (folderAutoTagRequests === 1) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ processed: 0, failed: 0, addedTags: 0, books: [], errors: [] }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        processed: 1,
        failed: 0,
        addedTags: 1,
        books: [{ filename: files[1].name, driveFileId: files[1].driveFileId, assignedTag: '소프트웨어', addedTags: ['소프트웨어'], removedTags: [] }],
        errors: [],
      }),
    });
    return;
  }
  if (route.request().method() === 'POST' && pathname.endsWith('/auto') && pathname.startsWith('/api/tags/book/')) {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ title: files[0].name.replace(/\.pdf$/i, ''), suggestedTags: ['데이터베이스'], addedTags: ['데이터베이스'], removedTags: ['소프트웨어'] }),
    });
    return;
  }
  const json = pathname === '/api/folders'
    ? [{ name: 'PDFit Library', pdfCount: files.length, createdAt: '2026-09-14T05:00:00.000Z', isRoot: true, color: '#3b82f6' }]
    : pathname === '/api/tags/summary' ? tags
      : pathname === '/api/bookmarks' ? []
        : pathname.endsWith('/files') ? files
          : pathname.startsWith('/api/tags/folder/') ? {
            'drive-book-a': ['소프트웨어'],
            'drive-book-b': [],
          }
            : pathname.startsWith('/api/progress/') ? null
              : [];
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
});
await page.goto(`${baseUrl}/folder/PDFit%20Library`, { waitUntil: 'networkidle' });
await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });

const tagRows = page.locator('.pdfit-tag-row');
const tagCount = await tagRows.count();
assert.equal(tagCount, tags.length, '태그가 누락되거나 중복 렌더링됨');
const names = await tagRows.locator('.MuiListItemText-root').evaluateAll((items) => items.map((item) => item.textContent?.replace(/^#\s*/, '').replace(/\d+$/, '').trim()));
assert.equal(names.length, new Set(names).size, `중복 태그 발견: ${names.join(', ')}`);
// 사이드바 태그는 이름의 유니코드 코드 순(숫자 < 대문자 < 소문자 < 한글)이다.
assert.deepEqual(names, [
  'UI·UX', '경제·경영', '과학', '글쓰기', '디자인', '마케팅', '소프트웨어',
  '심리학', '운영체제', '웹 개발', '인공지능', '자기계발', '창업', '투자·재테크', '프로그래밍',
]);
assert.deepEqual(names, [...names].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)), '태그가 유니코드 순으로 정렬되지 않음');
assert.equal(await page.locator('[data-tag-group]').count(), 0, '그룹 소제목용 래퍼가 남아 있음');
const totalTagAssignments = tags.reduce((total, tag) => total + tag.bookCount, 0);
assert.equal(
  await page.getByTestId('tag-assignment-total').textContent(),
  `${totalTagAssignments}`,
  '태그 제목 옆 숫자가 태그 연결 합계와 다름',
);
assert.equal(
  await page.getByTestId('tag-assignment-total').getAttribute('title'),
  `태그 연결 합계 ${totalTagAssignments}개`,
  '태그 연결 합계 툴팁이 표시되지 않음',
);
await page.getByRole('button', { name: '태그 전체 초기화' }).click();
const resetAllTagsDialog = page.getByRole('dialog');
assert.equal(
  await resetAllTagsDialog.getByText(`모든 문서의 태그 연결 ${totalTagAssignments}개를 초기화할까요? 문서와 보관함 항목은 유지됩니다.`, { exact: true }).count(),
  1,
  '태그 전체 초기화 확인 숫자가 태그 연결 합계와 다름',
);
await resetAllTagsDialog.getByRole('button', { name: '취소' }).click();
const clearFolderTagsButton = page.getByTestId('clear-folder-tags');
const clearFolderTagsBeforeHover = await clearFolderTagsButton.evaluate((element) => {
  const style = getComputedStyle(element);
  return { color: style.color, backgroundColor: style.backgroundColor };
});
await clearFolderTagsButton.hover();
await page.waitForTimeout(180);
const clearFolderTagsAfterHover = await clearFolderTagsButton.evaluate((element) => {
  const style = getComputedStyle(element);
  return { color: style.color, backgroundColor: style.backgroundColor };
});
assert.notDeepEqual(clearFolderTagsAfterHover, clearFolderTagsBeforeHover, '폴더 태그 전체 해제 버튼의 호버 색상이 변하지 않음');

const refreshFolderButton = page.getByTestId('refresh-folder');
const refreshFolderBeforeHover = await refreshFolderButton.evaluate((element) => {
  const style = getComputedStyle(element);
  return { color: style.color, backgroundColor: style.backgroundColor };
});
await refreshFolderButton.hover();
await page.waitForTimeout(180);
const refreshFolderAfterHover = await refreshFolderButton.evaluate((element) => {
  const style = getComputedStyle(element);
  return { color: style.color, backgroundColor: style.backgroundColor };
});
assert.notDeepEqual(refreshFolderAfterHover, refreshFolderBeforeHover, '새로고침 버튼의 호버 색상이 변하지 않음');
assert.equal(names.includes('기타'), false, 'AI 제어 분류에 기타 태그가 표시됨');

const firstTagColorButton = tagRows.nth(0).locator('button[aria-label="태그 색상 변경"]');
await firstTagColorButton.click();
await page.getByRole('button', { name: '#14b8a6' }).click();
await page.waitForTimeout(50);
assert.equal(await firstTagColorButton.locator('svg').evaluate((element) => getComputedStyle(element).color), 'rgb(20, 184, 166)', '서버 응답 전에 선택한 태그 색상이 즉시 반영되지 않음');
await page.waitForTimeout(500);
assert.deepEqual(changedTagColors, ['#14b8a6'], '태그 색상 변경 요청이 한 번만 전송되지 않음');

const firstTag = names[0];
await tagRows.nth(0).locator('.MuiListItemButton-root').click();
await page.waitForLoadState('networkidle');
assert.ok(firstTag && page.url().endsWith(`/tag/${encodeURIComponent(firstTag)}`), `태그 이동 실패: ${page.url()}`);

await page.goto(`${baseUrl}/folder/PDFit%20Library`, { waitUntil: 'networkidle' });
assert.equal(await page.getByRole('button', { name: '목록 보기' }).count(), 1);
assert.equal(await page.getByRole('button', { name: '표지 보기' }).count(), 1);
assert.equal(await page.getByRole('button', { name: 'AI 일괄 태그' }).count(), 1);
assert.equal(await page.getByTestId('ai-auto-tag-all').evaluate((element) => getComputedStyle(element).color), 'rgb(245, 158, 11)', '상단 AI 일괄 태그 버튼이 골드 색상이 아님');
const listToolbar = page.getByTestId('folder-list-toolbar');
assert.equal(await listToolbar.count(), 1);
const pdfSearch = page.getByTestId('pdf-search-input');
const [selectAllPosition, searchPosition, aiButtonPosition] = await Promise.all([
  page.getByTestId('pdf-select-all').boundingBox(),
  pdfSearch.boundingBox(),
  page.getByTestId('ai-auto-tag-all').boundingBox(),
]);
assert.ok(selectAllPosition && searchPosition && aiButtonPosition && searchPosition.x > selectAllPosition.x && searchPosition.x + searchPosition.width <= aiButtonPosition.x, 'PDF 검색창이 전체 선택과 AI 작업 사이에 배치되지 않음');
await pdfSearch.fill('올바른');
assert.equal(await page.locator('.pdfit-pdf-row').count(), 2, '파일명 검색 결과가 올바르지 않음');
assert.equal(await page.getByTestId('pdf-search-result-count').textContent(), '2/2', '검색 결과 수가 표시되지 않음');
await listToolbar.getByRole('button', { name: '표지 보기' }).click();
assert.equal(await page.getByTestId('pdf-cover-grid').locator('[data-testid="pdf-cover-thumbnail"]').count(), 2, '표지 보기에 검색 결과가 적용되지 않음');
await listToolbar.getByRole('button', { name: 'PDF 검색 지우기' }).click();
assert.equal(await page.getByTestId('pdf-cover-grid').locator('[data-testid="pdf-cover-thumbnail"]').count(), 2, '검색 초기화 후 표지 목록이 복원되지 않음');
await listToolbar.getByRole('button', { name: '목록 보기' }).click();
await pdfSearch.fill('존재하지 않는 문서');
assert.equal(await page.getByTestId('pdf-search-empty').count(), 1, '검색 결과 없음 상태가 표시되지 않음');
await page.getByTestId('pdf-search-empty').getByRole('button', { name: 'PDF 검색 지우기' }).click();
assert.equal(await page.locator('.pdfit-pdf-row').count(), 2, '빈 검색 초기화 후 PDF 목록이 복원되지 않음');
assert.equal(await listToolbar.getByTestId('pdf-select-all').count(), 1, '전체 선택이 목록 제어행 밖에 있음');
assert.equal(await listToolbar.getByTestId('delete-selected-pdfs').count(), 1, '선택 삭제가 목록 제어행 밖에 있음');
assert.equal(await listToolbar.getByRole('button', { name: '목록 보기' }).count(), 1, '보기 전환이 목록 제어행 밖에 있음');
assert.equal(await listToolbar.getByRole('button', { name: '표지 보기' }).count(), 1, '표지 전환이 목록 제어행 밖에 있음');
assert.equal(await listToolbar.getByRole('button', { name: 'AI 일괄 태그' }).count(), 1, '폴더 작업이 통합 툴바 밖에 있음');
assert.equal(await page.getByRole('button', { name: 'AI 일괄 태그' }).count(), 1, 'AI 작업 버튼이 중복 렌더링됨');
await page.getByRole('button', { name: 'AI 일괄 태그' }).click();
const autoTagDialog = page.getByRole('dialog');
assert.equal(await autoTagDialog.getByText('이 폴더에서 태그가 없는 책 1권에 자동 태그를 실행할까요?', { exact: true }).count(), 1, '확인창이 이미 태그된 PDF를 대상 수에서 제외하지 않음');
await autoTagDialog.getByRole('button', { name: 'AI 일괄 태그' }).click();
const aiStatus = page.getByTestId('ai-bulk-tag-status');
await aiStatus.waitFor({ state: 'visible' });
assert.equal(await aiStatus.getByText('AI가 태그 없는 책 1권을 확인하고 있습니다…', { exact: true }).count(), 1, 'AI 진행 안내가 이미 태그된 PDF를 제외하지 않음');
assert.ok((await aiStatus.boundingBox())?.width > 500, 'AI 진행 안내가 버튼 폭에 갇혀 있음');
const bulkTagButton = page.getByTestId('ai-auto-tag-all');
assert.equal(await bulkTagButton.getByText('태그 취소', { exact: true }).count(), 1, '진행 중 버튼이 태그 취소로 전환되지 않음');
assert.ok(await bulkTagButton.isEnabled(), '진행 중 태그 취소 버튼이 비활성 상태임');
await bulkTagButton.click();
assert.equal(await bulkTagButton.getByText('취소 중…', { exact: true }).count(), 1, '취소 요청 상태가 버튼에 표시되지 않음');
assert.equal(await aiStatus.getByText('현재 처리 중인 묶음을 마친 뒤 태그 작업을 중단합니다…', { exact: true }).count(), 1, '취소 처리 범위가 안내되지 않음');
await page.screenshot({ path: path.join(output, 'ai-bulk-progress.png'), fullPage: true });
await aiStatus.waitFor({ state: 'hidden' });
const cancelledNotice = page.locator('.MuiSnackbar-root .MuiAlert-root');
await cancelledNotice.getByText('책 1권 중 0권 처리 후 일괄 태그를 취소했습니다.', { exact: true }).waitFor({ state: 'visible' });
await cancelledNotice.getByRole('button').click();
assert.equal(await bulkTagButton.getByText('AI 일괄 태그', { exact: true }).count(), 1, '취소 완료 후 일괄 태그 버튼이 복원되지 않음');

await bulkTagButton.click();
await page.getByRole('dialog').getByRole('button', { name: 'AI 일괄 태그' }).click();
await aiStatus.waitFor({ state: 'visible' });
await aiStatus.waitFor({ state: 'hidden' });
const completedNotice = page.locator('.MuiSnackbar-root .MuiAlert-root');
await completedNotice.getByText('책 1권에 태그 1개를 추가했습니다.', { exact: true }).waitFor({ state: 'visible' });
assert.equal(folderAutoTagRequests, 2, '취소 후 남은 미분류 PDF에 대한 요청 횟수가 다름');
if (await completedNotice.count()) await completedNotice.getByRole('button').click();
assert.equal(await page.locator('.pdfit-pdf-row').count(), 2, '같은 제목의 PDF가 한 행으로 합쳐짐');
assert.equal(await page.locator('.pdfit-pdf-row').getByText('소프트웨어×', { exact: true }).count(), 2, '같은 제목 PDF의 태그가 각각 표시되지 않음');
assert.match(await tagRows.filter({ hasText: '소프트웨어' }).first().textContent(), /소프트웨어2/, '같은 태그를 가진 중복 제목 PDF 2권이 태그 수에 반영되지 않음');
await page.mouse.move(700, 20);
const firstRow = page.locator('.pdfit-pdf-row').first();
assert.equal(await firstRow.getByTestId('pdf-ai-auto-tag').evaluate((element) => getComputedStyle(element).color), 'rgb(245, 158, 11)', 'PDF 행 AI 태그 아이콘이 골드 색상이 아님');
if (await page.evaluate(() => matchMedia('(hover: hover)').matches)) {
  await page.waitForTimeout(180);
  const restingActionOpacity = Number(await firstRow.locator('div.pdfit-row-reveal').evaluate((element) => getComputedStyle(element).opacity));
  assert.ok(restingActionOpacity >= 0.5 && restingActionOpacity < 0.7, `행 작업 아이콘이 기본 상태에서 은은하게 노출되지 않음: ${restingActionOpacity}`);
  assert.equal(await firstRow.locator('input.pdfit-row-selection').evaluate((element) => getComputedStyle(element).opacity), '1', '행 체크박스가 기본 상태에서 노출되지 않음');
  await firstRow.hover();
  await page.waitForTimeout(180);
  assert.equal(await firstRow.locator('div.pdfit-row-reveal').evaluate((element) => getComputedStyle(element).opacity), '1', '행 hover 시 작업이 노출되지 않음');
  assert.equal(await firstRow.locator('input.pdfit-row-selection').evaluate((element) => getComputedStyle(element).opacity), '1', '행 hover 시 체크박스가 노출되지 않음');
}
await firstRow.getByTestId('pdf-ai-auto-tag').click();
await page.getByText('AI 태그를 추가했습니다: 데이터베이스', { exact: true }).waitFor({ state: 'visible' });
assert.equal(await firstRow.getByText('데이터베이스×', { exact: true }).count(), 1, '새 서점 분류 태그가 행에 반영되지 않음');
assert.equal(await firstRow.getByText('소프트웨어×', { exact: true }).count(), 0, '이전의 잘못된 자동 분류가 교체되지 않음');
await page.locator('.MuiSnackbar-root .MuiAlert-root').getByRole('button').click();
await pdfSearch.fill('데이터베이스');
assert.equal(await page.locator('.pdfit-pdf-row').count(), 1, '태그명 검색 결과가 올바르지 않음');
assert.equal(await page.getByTestId('pdf-search-result-count').textContent(), '1/2', '태그 검색 결과 수가 표시되지 않음');
await listToolbar.getByRole('button', { name: 'PDF 검색 지우기' }).click();
const [selectAllBox, firstRowBox] = await Promise.all([
  page.getByTestId('pdf-select-all').boundingBox(),
  page.getByTestId('pdf-selection-checkbox').first().boundingBox(),
]);
assert.ok(selectAllBox && firstRowBox && Math.abs(selectAllBox.x - firstRowBox.x) <= 16, '전체 선택과 행 체크박스 열이 정렬되지 않음');
await page.getByTestId('pdf-select-all').click();
assert.equal(await listToolbar.getByText('2개 선택', { exact: true }).count(), 1);
assert.ok(await page.getByTestId('delete-selected-pdfs').isEnabled());
assert.equal(await page.getByTestId('delete-selected-pdfs').getByText('선택 삭제', { exact: true }).count(), 0, '삭제 버튼에 텍스트가 표시됨');
if (await page.evaluate(() => matchMedia('(hover: hover)').matches)) {
  await page.mouse.move(700, 20);
  await page.waitForTimeout(180);
  assert.equal(await firstRow.locator('.pdfit-row-selection').evaluate((element) => getComputedStyle(element).opacity), '1', '선택된 행의 체크박스가 숨겨짐');
  const selectedActionOpacity = Number(await firstRow.locator('.pdfit-row-actions').evaluate((element) => getComputedStyle(element).opacity));
  assert.ok(selectedActionOpacity >= 0.5 && selectedActionOpacity < 0.7, '전체 선택 후 행 작업 아이콘의 기본 노출 강도가 달라짐');
}
await listToolbar.getByText('전체 해제', { exact: true }).click();
assert.equal(await listToolbar.getByText('2개 선택', { exact: true }).count(), 0, '전체 해제가 반영되지 않음');
assert.equal(await page.getByTestId('pdf-selection-checkbox').locator(':checked').count(), 0, 'PDF 행 선택이 남아 있음');
assert.ok(!(await page.getByTestId('delete-selected-pdfs').isEnabled()), '선택 해제 후 삭제 버튼이 활성 상태임');
await page.getByTestId('pdf-select-all').click({ clickCount: 2, delay: 0 });
assert.equal(await page.getByTestId('pdf-selection-checkbox').locator(':checked').count(), 0, '빠른 연속 클릭 후 전체 선택이 해제되지 않음');
assert.ok(!(await page.getByTestId('delete-selected-pdfs').isEnabled()), '빠른 연속 선택 해제 후 삭제 버튼이 활성 상태임');
await listToolbar.getByRole('button', { name: '표지 보기' }).click();
assert.equal(await page.getByTestId('pdf-cover-grid').count(), 1, '표지 보기가 표시되지 않음');
await listToolbar.getByRole('button', { name: '목록 보기' }).click();
assert.equal(await page.getByTestId('pdf-selection-checkbox').count(), files.length, '목록 보기가 복원되지 않음');
assert.ok(await page.getByTestId('clear-folder-tags').isEnabled(), '태그가 있는데 일괄 해제 버튼이 비활성 상태임');
  await page.getByTestId('clear-folder-tags').click();
  const clearDialog = page.getByRole('dialog');
  assert.equal(await clearDialog.locator('.MuiDialogTitle-root').getByTestId('LabelOffIcon').count(), 1, '안내 창 제목에 태그 해제 아이콘이 없음');
  assert.equal(await clearDialog.locator('.MuiDialogTitle-root').getByTestId('LabelOffIcon').evaluate((element) => getComputedStyle(element).color), 'rgb(245, 158, 11)', '안내 창 태그 해제 아이콘이 AI 골드 색상과 다름');
  assert.equal(await clearDialog.getByText(/PDF 2개에서 태그 연결 2개/).count(), 1);
  const clearAction = clearDialog.getByRole('button', { name: '태그 전체 해제' });
  assert.equal(await clearAction.getByTestId('LabelOffIcon').count(), 1, '태그 전체 해제 버튼에 태그 해제 아이콘이 없음');
  assert.equal(await clearAction.evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(245, 158, 11)', '태그 전체 해제 버튼이 AI 골드 색상과 다름');
  expectClearFailure = true;
  await clearAction.click();
const failureNotice = page.getByText('폴더 태그를 해제하지 못했습니다. test failure', { exact: true });
await failureNotice.waitFor({ state: 'visible' });
expectClearFailure = false;
assert.equal(clearedFolders.length, 1, '실패한 폴더 태그 해제에 중복 요청이 발생함');
const failureAlert = page.locator('.MuiSnackbar-root .MuiAlert-root');
assert.equal(await page.locator('.MuiAlert-root').count(), 1, '태그 오류가 상단 배너와 토스트에 중복 표시됨');
assert.ok((await failureAlert.boundingBox())?.width < 500, '태그 오류가 전체 폭 배너로 표시됨');
assert.ok(((await failureAlert.boundingBox())?.y ?? 9999) < 120, '태그 알림이 화면 상단에 표시되지 않음');
await failureAlert.getByRole('button').click();
assert.ok(await page.getByTestId('clear-folder-tags').isEnabled(), '실패 후 다시 시도할 수 없음');
await page.getByTestId('clear-folder-tags').click();
await page.getByRole('dialog').getByRole('button', { name: '태그 전체 해제' }).click();
await page.getByText('이 폴더에서 태그 연결 2개를 해제했습니다.', { exact: true }).waitFor({ state: 'visible' });
const noticeColors = await page.getByRole('alert').last().evaluate((element) => ({
  backgroundColor: getComputedStyle(element).backgroundColor,
  color: getComputedStyle(element).color,
}));
assert.ok(['rgb(35, 37, 41)', 'rgb(32, 33, 36)'].includes(noticeColors.backgroundColor), '알림 배경이 중립 다크 톤이 아님');
assert.ok(['rgb(243, 244, 246)', 'rgb(245, 245, 245)'].includes(noticeColors.color), '알림 텍스트 대비가 지정값과 다름');
await page.screenshot({ path: path.join(output, 'neutral-notice.png'), fullPage: true });
assert.equal(clearedFolders.length, 2, '각 폴더 태그 해제가 단일 요청으로 처리되지 않음');
assert.ok(!(await page.getByTestId('clear-folder-tags').isEnabled()), '태그 해제 후 버튼이 비활성화되지 않음');
await page.mouse.move(760, 500);
assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));

await page.setViewportSize({ width: 1024, height: 768 });
await page.waitForTimeout(250);
await page.screenshot({ path: path.join(output, 'compact.png'), fullPage: true });
assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));

await browser.close();
assert.deepEqual(errors, []);
console.log(`PASS ordered-tags=${tagCount} selection-toggle=ok view-toggle=ok folder-tags-cleared=1-request screenshots=${output}`);
