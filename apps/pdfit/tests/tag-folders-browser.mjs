import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// 태그 폴더를 배포된 서버에서 검증한다.
//  A. API: 만들기·중복 409·태그 넣기/빼기·없는 대상 404·삭제 후에도 태그가 남는다.
//  B. 화면: 헤더 아이콘으로 만들기, 미분류 바로 아래에 유니코드순으로 폴더가 먼저 오고 그 아래 태그,
//     폴더 제목·빈 본문·기존 태그 행으로 드롭하고, 일반 태그의 폴더 메뉴로도 넣고,
//     한 태그를 두 폴더에 넣을 수 있고, 폴더 삭제 시 태그가 일반 목록으로 돌아오고, 폴더 클릭은 이동하지 않는다.
// 임시 폴더(이름에 실행 ID 포함)만 만들고 끝에서 모두 지운다. 기존 태그와 책은 건드리지 않는다.
const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const runId = process.env.PDFIT_TEST_RUN ?? '20261120_tag_folders';
const output = process.env.PDFIT_TEST_ARTIFACT_DIR ?? fileURLToPath(new URL(`./reports/tag-folders/${runId}/`, import.meta.url));
await mkdir(output, { recursive: true });
const shot = (name) => join(output, name);
const api = (path, init) => fetch(`${origin}/api/tag-folders${path}`, init);
const post = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const stamp = String(Date.now()).slice(-6);
const nameA = `가나-${stamp}`;
const nameB = `나다-${stamp}`;
const created = [];
const membershipPath = (folder, tag) => `/${encodeURIComponent(folder)}/tags/${encodeURIComponent(tag)}`;
const changeMembership = async (page, method, folder, tag, action) => {
  const [response] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === method
      && new URL(response.url()).pathname === `/api/tag-folders${membershipPath(folder, tag)}`, { timeout: 10000 }),
    action(),
  ]);
  assert.equal(response.status(), 200);
};

const browser = await chromium.launch({ headless: true, ...(process.env.PDFIT_TEST_CHANNEL ? { channel: process.env.PDFIT_TEST_CHANNEL } : {}) });
const results = {};

try {
  const summaries = await (await fetch(`${origin}/api/tags/summary`)).json();
  const tagNames = summaries.map((row) => row.name);
  const before = await (await api('')).json();
  const grouped = new Set(before.flatMap((folder) => folder.tags));
  const ungrouped = tagNames.filter((tag) => !grouped.has(tag) && /[가-힣]/u.test(tag)).sort();
  assert.ok(ungrouped.length >= 3, '폴더 밖에 한국어 태그가 3개 이상 필요하다');
  const [tagOne, tagTwo] = ungrouped;
  const menuTag = ungrouped.at(-1);

  // ── A. API ────────────────────────────────────────────────
  {
    assert.equal((await api('', post({ name: '  ' }))).status, 400);
    const make = await api('', post({ name: nameA }));
    assert.equal(make.status, 201); created.push(nameA);
    assert.equal((await api('', post({ name: nameA }))).status, 409, '같은 이름은 409');
    assert.equal((await api(`/${encodeURIComponent(nameA)}/tags/${encodeURIComponent('__없는태그__')}`, { method: 'PUT' })).status, 404);
    assert.equal((await api(`/${encodeURIComponent('__없는폴더__')}/tags/${encodeURIComponent(tagOne)}`, { method: 'PUT' })).status, 404);
    assert.equal((await api(`/${encodeURIComponent(nameA)}/tags/${encodeURIComponent(tagOne)}`, { method: 'PUT' })).status, 200);
    const listed = (await (await api('')).json()).find((folder) => folder.name === nameA);
    assert.deepEqual(listed.tags, [tagOne]);
    await api(`/${encodeURIComponent(nameA)}/tags/${encodeURIComponent(tagOne)}`, { method: 'DELETE' });
    assert.deepEqual((await (await api('')).json()).find((folder) => folder.name === nameA).tags, []);
    await api(`/${encodeURIComponent(nameA)}`, { method: 'DELETE' });
    created.length = 0;
    assert.equal((await (await api('')).json()).length, before.length);
    const afterTags = (await (await fetch(`${origin}/api/tags/summary`)).json()).map((row) => row.name);
    assert.deepEqual(afterTags, tagNames, '폴더를 지워도 태그는 그대로 남는다');
    results.api = { baseline: before.length, tags: tagNames.length };
  }

  // ── B. 화면 ───────────────────────────────────────────────
  const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 1440 } });
  await context.addInitScript((existingNames) => {
    const key = 'pdfit.lnb.collapsedTagFolders';
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(existingNames));
  }, before.map((folder) => folder.name));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
  try {
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('lnb-tags-section').waitFor({ state: 'visible', timeout: 30000 });
    await page.getByTestId('lnb-untagged').waitFor({ state: 'visible', timeout: 30000 });

    const createFolder = async (name) => {
      await page.getByTestId('lnb-create-tag-folder').click();
      await page.getByTestId('create-tag-folder-input').locator('input').fill(name);
      await page.getByTestId('create-tag-folder-save').click();
      created.push(name);
      await page.getByTestId('lnb-tag-folder').filter({ hasText: name }).waitFor({ state: 'visible', timeout: 15000 });
    };
    // 일부러 B(나다)를 먼저 만들어 정렬이 생성 순서가 아님을 본다.
    await createFolder(nameB);
    await createFolder(nameA);

    // 중복 이름은 대화상자에서 막힌다.
    await page.getByTestId('lnb-create-tag-folder').click();
    await page.getByTestId('create-tag-folder-input').locator('input').fill(nameA);
    await page.getByTestId('create-tag-folder-save').click();
    await page.getByText('이미 사용 중인 태그 폴더 이름입니다.').waitFor({ state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: '취소' }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });

    // 위치와 순서: 미분류 → 폴더(유니코드순 가나, 나다) → 일반 태그.
    const order = await page.evaluate(({ a, b }) => {
      const pos = (el) => el ? el.getBoundingClientRect().top : NaN;
      const folders = [...document.querySelectorAll('[data-testid="lnb-tag-folder"]')];
      const mine = folders.filter((el) => el.textContent.includes(a) || el.textContent.includes(b));
      const tagRow = document.querySelector('[data-testid="lnb-tag-row"]');
      return {
        untagged: pos(document.querySelector('[data-testid="lnb-untagged-row"]')),
        names: mine.map((el) => el.querySelector('[data-testid="lnb-tag-folder-toggle"]').getAttribute('aria-label')),
        firstFolder: pos(folders[0]), lastFolder: pos(folders[folders.length - 1]),
        firstTag: pos(tagRow),
      };
    }, { a: nameA, b: nameB });
    assert.deepEqual(order.names, [nameA, nameB], '폴더는 유니코드 순이다');
    assert.ok(order.untagged < order.firstFolder, '폴더는 미분류보다 아래다');
    assert.ok(order.lastFolder < order.firstTag, '폴더가 태그보다 먼저 나온다');
    await page.screenshot({ path: shot('sidebar-folders.png'), clip: { x: 0, y: 0, width: 320, height: 640 } });

    const folderA = page.getByTestId('lnb-tag-folder').filter({ hasText: nameA });
    const folderB = page.getByTestId('lnb-tag-folder').filter({ hasText: nameB });
    const rootRow = (name) => page.getByTestId('lnb-tag-row').filter({ has: page.getByText(name, { exact: true }) });
    const memberRow = (folder, name) => folder.getByTestId('lnb-folder-tag-row').filter({ has: page.getByText(name, { exact: true }) });
    const assertAssignment = async (folder, name, action) => {
      await changeMembership(page, 'PUT', folder, name, action);
      assert.ok((await (await api('')).json()).find((row) => row.name === folder).tags.includes(name));
    };

    // 빈 폴더의 본문에 드롭한다. 제목 행에는 드롭하지 않는다.
    await assertAssignment(nameA, tagOne, () => rootRow(tagOne).dragTo(folderA.getByText('태그를 끌어다 놓으세요.'), { steps: 12 }));
    await memberRow(folderA, tagOne).waitFor({ state: 'visible', timeout: 15000 });
    assert.equal(await rootRow(tagOne).count(), 0, '폴더로 옮긴 태그는 일반 목록에서 사라진다');
    assert.equal(await folderA.getByTestId('lnb-tag-folder-count').innerText(), '1');

    // 이미 태그가 들어 있는 폴더는 하위 태그의 버튼 위에서도 드롭을 받는다.
    await assertAssignment(nameA, tagTwo, () => rootRow(tagTwo).dragTo(memberRow(folderA, tagOne).getByText(tagOne, { exact: true }), { steps: 12 }));
    await memberRow(folderA, tagTwo).waitFor({ state: 'visible' });
    assert.equal(await rootRow(tagTwo).count(), 0);
    const removeTagFromA = memberRow(folderA, tagTwo).getByTestId('lnb-folder-tag-remove');
    await changeMembership(page, 'DELETE', nameA, tagTwo, () => removeTagFromA.click());
    await rootRow(tagTwo).waitFor({ state: 'visible' });

    // 접힌 폴더의 제목에도 드롭할 수 있으며, 한 태그는 두 폴더에 속할 수 있다.
    const toggleB = folderB.getByRole('button', { name: nameB, exact: true });
    await toggleB.click();
    await assertAssignment(nameB, tagOne, () => memberRow(folderA, tagOne).dragTo(toggleB, { steps: 12 }));
    assert.equal(await toggleB.getAttribute('aria-expanded'), 'false');
    await toggleB.click();
    await memberRow(folderB, tagOne).waitFor({ state: 'visible', timeout: 15000 });
    assert.equal(await page.getByTestId('lnb-folder-tag-row').filter({ has: page.getByText(tagOne, { exact: true }) }).count(), 2, '여러 폴더에 속할 수 있다');
    await page.screenshot({ path: shot('two-folders.png'), clip: { x: 0, y: 0, width: 320, height: 640 } });

    // 긴 목록 아래쪽에서도 폴더/휴지통 버튼을 쓸 수 있다. 키보드로 메뉴를 열고 선택한다.
    const menuButton = rootRow(menuTag).getByRole('button', { name: '태그 폴더로 이동', exact: true });
    const trashButton = rootRow(menuTag).getByRole('button', { name: '태그 삭제', exact: true });
    const moveMenu = page.getByRole('menu', { name: '태그 폴더로 이동' });
    const urlBeforeMenu = page.url();
    await trashButton.click();
    await page.getByRole('dialog').getByRole('button', { name: '취소', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await menuButton.press('Enter');
    await moveMenu.getByRole('menuitem', { name: nameB, exact: true }).waitFor({ state: 'visible' });
    await page.screenshot({ path: shot('folder-menu.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await moveMenu.waitFor({ state: 'hidden' });
    assert.equal(await menuButton.evaluate((button) => button === document.activeElement), true);
    await menuButton.press('Enter');
    await assertAssignment(nameB, menuTag, () => moveMenu.getByRole('menuitem', { name: nameB, exact: true }).press('Enter'));
    await memberRow(folderB, menuTag).waitFor({ state: 'visible' });
    await moveMenu.waitFor({ state: 'hidden' });
    assert.equal(await rootRow(menuTag).count(), 0);
    assert.equal(page.url(), urlBeforeMenu);
    const unlinkMenuTag = () => changeMembership(page, 'DELETE', nameB, menuTag, () => memberRow(folderB, menuTag).getByTestId('lnb-folder-tag-remove').click());
    await unlinkMenuTag();
    await rootRow(menuTag).waitFor({ state: 'visible' });

    const mobile = await browser.newContext({ locale: 'ko-KR', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const phone = await mobile.newPage();
    phone.on('pageerror', (error) => errors.push(`mobile: ${error.message}`));
    try {
      await phone.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
      await phone.getByRole('button', { name: '메뉴 열기', exact: true }).tap();
      const phoneRow = phone.getByTestId('lnb-tag-row').filter({ has: phone.getByText(menuTag, { exact: true }) });
      await phoneRow.getByRole('button', { name: '태그 폴더로 이동', exact: true }).tap();
      const phoneMenu = phone.getByRole('menu', { name: '태그 폴더로 이동' });
      const choice = phoneMenu.getByRole('menuitem', { name: nameB, exact: true });
      await choice.waitFor({ state: 'visible' });
      await phone.screenshot({ path: shot('folder-menu-mobile.png'), animations: 'disabled' });
      await changeMembership(phone, 'PUT', nameB, menuTag, () => choice.tap());
      await phone.getByTestId('lnb-tag-folder').filter({ hasText: nameB }).getByText(menuTag, { exact: true }).waitFor({ state: 'visible' });
      assert.equal(await phoneRow.count(), 0);
    } finally { await mobile.close(); }
    await unlinkMenuTag();
    await rootRow(menuTag).waitFor({ state: 'visible' });

    // 접고 펴기: 접으면 안의 태그가 숨고, 책 목록으로 이동하지 않는다.
    const toggleA = folderA.getByTestId('lnb-tag-folder-toggle');
    const urlBefore = page.url();
    await toggleA.click();
    await folderA.getByTestId('lnb-tag-folder-tags').waitFor({ state: 'detached', timeout: 5000 });
    assert.equal(await toggleA.getAttribute('aria-expanded'), 'false');
    assert.equal(page.url(), urlBefore, '폴더를 눌러도 책 목록으로 이동하지 않는다');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('lnb-tag-folder').filter({ hasText: nameA }).waitFor({ state: 'visible', timeout: 30000 });
    assert.equal(await page.getByTestId('lnb-tag-folder').filter({ hasText: nameA }).getByTestId('lnb-tag-folder-toggle').getAttribute('aria-expanded'), 'false', '접힘 상태는 새로고침 뒤에도 유지된다');
    await page.getByTestId('lnb-tag-folder').filter({ hasText: nameA }).getByTestId('lnb-tag-folder-toggle').click();
    await page.getByTestId('lnb-tag-folder').filter({ hasText: nameA }).getByTestId('lnb-folder-tag-row').filter({ hasText: tagOne }).waitFor({ state: 'visible' });

    // 태그를 누르면 그 태그의 책 목록으로 간다(폴더 안 행도 동일).
    await page.getByTestId('lnb-tag-folder').filter({ hasText: nameA }).getByTestId('lnb-folder-tag-row').filter({ hasText: tagOne }).getByRole('button').first().click();
    await page.waitForURL(`**/tag/${encodeURIComponent(tagOne)}`, { timeout: 15000 });

    // 폴더 B에서 태그만 빼면 아직 A에 있으므로 일반 목록에는 안 나온다. A에서도 빼면 돌아온다.
    await page.getByTestId('lnb-tag-folder').filter({ hasText: nameB }).getByTestId('lnb-folder-tag-remove').click({ force: true });
    await memberRow(folderB, tagOne).waitFor({ state: 'detached', timeout: 15000 });
    await memberRow(folderA, tagOne).waitFor({ state: 'visible' });
    assert.equal(await rootRow(tagOne).count(), 0);

    // 폴더 A 삭제: 확인 대화상자 → 폴더가 사라지고 태그는 일반 목록으로 돌아온다.
    await page.getByTestId('lnb-tag-folder').filter({ hasText: nameA }).getByTestId('lnb-tag-folder-delete').click({ force: true });
    await page.getByRole('button', { name: '삭제', exact: true }).click();
    await page.getByTestId('lnb-tag-folder').filter({ hasText: nameA }).waitFor({ state: 'detached', timeout: 15000 });
    created.splice(created.indexOf(nameA), 1);
    await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 5000 });
    await page.getByTestId('lnb-tag-row').filter({ hasText: tagOne }).first().waitFor({ state: 'visible', timeout: 15000 });
    const tagsAfter = (await (await fetch(`${origin}/api/tags/summary`)).json()).map((row) => row.name);
    assert.deepEqual(tagsAfter, tagNames, '폴더 삭제로 태그가 지워지지 않는다');
    await page.screenshot({ path: shot('after-delete.png'), clip: { x: 0, y: 0, width: 320, height: 640 } });

    // 마지막 폴더(B)도 화면에서 지운다.
    await page.getByTestId('lnb-tag-folder').filter({ hasText: nameB }).getByTestId('lnb-tag-folder-delete').click({ force: true });
    await page.getByRole('button', { name: '삭제', exact: true }).click();
    await page.getByTestId('lnb-tag-folder').filter({ hasText: nameB }).waitFor({ state: 'detached', timeout: 15000 });
    created.splice(created.indexOf(nameB), 1);
    await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 5000 });
    assert.deepEqual(await (await api('')).json(), before, '임시 폴더만 지워지고 실행 전 폴더와 소속은 그대로다');
    // 실제 폴더를 삭제하지 않고 빈 폴더 목록 응답을 재현한다.
    await page.route('**/api/tag-folders', (route) => route.fulfill({ json: [] }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await menuButton.click();
    const emptyItem = moveMenu.getByRole('menuitem', { name: '아직 태그 폴더가 없습니다.' });
    await emptyItem.waitFor({ state: 'visible' });
    assert.equal(await emptyItem.isDisabled(), true);
    assert.equal(await page.getByTestId('lnb-tag-folders').count(), 0, '폴더가 없으면 목록 영역도 그리지 않는다');
    assert.deepEqual(errors, []);
    results.ui = { tagOne, tagTwo, menuTag, folders: [nameA, nameB], emptyMenuChecked: true, pageErrors: errors.length };
  } finally { await context.close(); }

  console.log(JSON.stringify({ ok: true, origin, results }, null, 2));
} finally {
  for (const name of created) await api(`/${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => undefined);
  await browser.close();
}
