import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

// 태그 폴더를 배포된 서버에서 검증한다.
//  A. API: 만들기·중복 409·태그 넣기/빼기·없는 대상 404·삭제 후에도 태그가 남는다.
//  B. 화면: 헤더 아이콘으로 만들기, 미분류 바로 아래에 유니코드순으로 폴더가 먼저 오고 그 아래 태그,
//     태그를 폴더로 드래그하면 아래 일반 목록에서 사라지고 폴더 안에만 보이며, 접고 펴고,
//     한 태그를 두 폴더에 넣을 수 있고, 폴더 삭제 시 태그가 일반 목록으로 돌아오고, 폴더 클릭은 이동하지 않는다.
// 임시 폴더(이름에 실행 ID 포함)만 만들고 끝에서 모두 지운다. 기존 태그와 책은 건드리지 않는다.
const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const runId = process.env.PDFIT_TEST_RUN ?? '20261120_tag_folders';
const output = new URL(`./reports/tag-folders/${runId}/`, import.meta.url);
await mkdir(output, { recursive: true });
const shot = (name) => decodeURIComponent(new URL(name, output).pathname.slice(1));
const api = (path, init) => fetch(`${origin}/api/tag-folders${path}`, init);
const post = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const stamp = String(Date.now()).slice(-6);
const nameA = `가나-${stamp}`;
const nameB = `나다-${stamp}`;
const created = [];

const browser = await chromium.launch({ headless: true, ...(process.env.PDFIT_TEST_CHANNEL ? { channel: process.env.PDFIT_TEST_CHANNEL } : {}) });
const results = {};

try {
  const summaries = await (await fetch(`${origin}/api/tags/summary`)).json();
  assert.ok(summaries.length >= 2, '태그가 둘 이상 있는 라이브러리가 필요하다');
  const tagNames = summaries.map((row) => row.name);
  const [tagOne, tagTwo] = tagNames;
  const before = await (await api('')).json();

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
  const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 1000 } });
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

    // 위치와 순서: 미분류 → 폴더(유니코드순 가나, 나다) → 일반 태그.
    const order = await page.evaluate(({ a, b, firstTag }) => {
      const pos = (el) => el ? el.getBoundingClientRect().top : NaN;
      const folders = [...document.querySelectorAll('[data-testid="lnb-tag-folder"]')];
      const mine = folders.filter((el) => el.textContent.includes(a) || el.textContent.includes(b));
      const tagRow = [...document.querySelectorAll('[data-testid="lnb-tag-row"]')].find((el) => el.textContent.includes(firstTag));
      return {
        untagged: pos(document.querySelector('[data-testid="lnb-untagged-row"]')),
        names: mine.map((el) => el.querySelector('[data-testid="lnb-tag-folder-toggle"]').getAttribute('aria-label')),
        firstFolder: pos(folders[0]), lastFolder: pos(folders[folders.length - 1]),
        firstTag: pos(tagRow),
      };
    }, { a: nameA, b: nameB, firstTag: tagOne });
    assert.deepEqual(order.names, [nameA, nameB], '폴더는 유니코드 순이다');
    assert.ok(order.untagged < order.firstFolder, '폴더는 미분류보다 아래다');
    assert.ok(order.lastFolder < order.firstTag, '폴더가 태그보다 먼저 나온다');
    await page.screenshot({ path: shot('sidebar-folders.png'), clip: { x: 0, y: 0, width: 320, height: 640 } });

    const folderA = page.getByTestId('lnb-tag-folder').filter({ hasText: nameA });
    const folderB = page.getByTestId('lnb-tag-folder').filter({ hasText: nameB });
    const rootRow = (name) => page.getByTestId('lnb-tag-row').filter({ hasText: name }).first();

    // 드래그: 태그를 폴더 A로 → 일반 목록에서 사라지고 폴더 안에만 보인다.
    await rootRow(tagOne).dragTo(folderA.getByTestId('lnb-tag-folder-toggle'));
    await folderA.getByTestId('lnb-folder-tag-row').filter({ hasText: tagOne }).waitFor({ state: 'visible', timeout: 15000 });
    assert.equal(await page.getByTestId('lnb-tag-row').filter({ hasText: tagOne }).count(), 0, '폴더로 옮긴 태그는 일반 목록에서 사라진다');
    assert.equal(await folderA.getByTestId('lnb-tag-folder-count').innerText(), '1');
    assert.deepEqual((await (await api('')).json()).find((folder) => folder.name === nameA).tags, [tagOne], '서버에 반영된다');

    // 한 태그를 두 폴더에: 폴더 A 안의 행을 폴더 B로 끈다.
    await folderA.getByTestId('lnb-folder-tag-row').filter({ hasText: tagOne }).dragTo(folderB.getByTestId('lnb-tag-folder-toggle'));
    await folderB.getByTestId('lnb-folder-tag-row').filter({ hasText: tagOne }).waitFor({ state: 'visible', timeout: 15000 });
    assert.equal(await page.getByTestId('lnb-folder-tag-row').filter({ hasText: tagOne }).count(), 2, '여러 폴더에 속할 수 있다');
    await page.screenshot({ path: shot('two-folders.png'), clip: { x: 0, y: 0, width: 320, height: 640 } });

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
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="lnb-folder-tag-row"]').length === 1 && [...document.querySelectorAll('[data-testid="lnb-folder-tag-row"]')].every((r) => r.textContent.includes(n)), tagOne, { timeout: 15000 });
    assert.equal(await page.getByTestId('lnb-tag-row').filter({ hasText: tagOne }).count(), 0);

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
    assert.equal(await page.getByTestId('lnb-tag-folders').count(), 0, '폴더가 없으면 목록 영역도 그리지 않는다');
    assert.deepEqual(errors, []);
    results.ui = { tagOne, tagTwo, folders: [nameA, nameB] };
  } finally { await context.close(); }

  console.log(JSON.stringify({ ok: true, origin, results }, null, 2));
} finally {
  for (const name of created) await api(`/${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => undefined);
  await browser.close();
}
