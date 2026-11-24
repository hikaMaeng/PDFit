import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const { PDFIT_TEST_ORIGIN: origin, PDFIT_TEST_ARTIFACT_DIR: output, PDFIT_TEST_CHANNEL: channel } = process.env;
assert.ok(origin && output, 'Provide an isolated PDFit origin and an artifact directory.');
await mkdir(output, { recursive: true });
const request = (path, method = 'GET', body) => fetch(`${origin}/api${path}`, {
  method,
  ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
});
const stamp = Date.now().toString(36);
const first = `A-${stamp}`;
const second = `B-${stamp}`;
const last = `C-${stamp}`;
const renamed = `자료 / 편집 % ${stamp}`;
const fixtureTag = `폴더테스트-${stamp}`;
const fixtureBook = '/tags/book/Fixture/fixture.pdf';
const errors = [];
const watch = (page) => page.on('pageerror', (error) => errors.push(error.message));
const rows = (page) => page.getByTestId('lnb-tag-folder');
const folder = (page, name) => rows(page).filter({ has: page.getByRole('button', { name, exact: true }) });
const toggle = (page, name) => folder(page, name).getByRole('button', { name, exact: true });
const editor = (page, name) => folder(page, name).getByRole('button', { name: `태그 폴더 ${name} 수정`, exact: true });
const arrow = (page, name, label) => folder(page, name).getByRole('button', { name: `${name} ${label} 이동`, exact: true });
const waitForOrder = (page, names) => page.waitForFunction((expected) => {
  const names = Array.from(document.querySelectorAll('[data-testid="lnb-tag-folder-toggle"]'), (row) => row.getAttribute('aria-label'));
  return names.length === expected.length && names.every((name, index) => name === expected[index]);
}, names);

const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
const cleanup = new Set();
try {
  assert.deepEqual(await (await request('/tag-folders')).json(), [], 'Start with an isolated library without tag folders.');
  assert.equal((await request(fixtureBook, 'POST', { tag: fixtureTag })).status, 200);
  for (const name of [second, first, last]) {
    assert.equal((await request('/tag-folders', 'POST', { name })).status, 201);
    cleanup.add(name);
  }
  assert.equal((await request(`/tag-folders/${encodeURIComponent(second)}/tags/${encodeURIComponent(fixtureTag)}`, 'PUT')).status, 200);
  const before = await (await request('/tag-folders')).json();

  const desktop = await browser.newContext({ locale: 'ko-KR', colorScheme: 'dark', viewport: { width: 1100, height: 850 } });
  await desktop.addInitScript((name) => {
    const key = 'pdfit.lnb.collapsedTagFolders';
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify([name]));
  }, second);
  const page = await desktop.newPage();
  const observer = await desktop.newPage();
  watch(page);
  watch(observer);
  await Promise.all([page.goto(origin), observer.goto(origin)]);
  await Promise.all([waitForOrder(page, [first, second, last]), waitForOrder(observer, [first, second, last])]);
  assert.equal(await toggle(page, second).getAttribute('aria-expanded'), 'false');
  assert.equal(await arrow(page, first, '위로').isDisabled(), true);
  assert.equal(await arrow(page, last, '아래로').isDisabled(), true);

  await arrow(page, second, '위로').press('Enter');
  await Promise.all([waitForOrder(page, [second, first, last]), waitForOrder(observer, [second, first, last])]);
  await editor(page, second).click();
  const dialog = page.getByRole('dialog', { name: '태그 폴더 수정', exact: true });
  const nameInput = dialog.getByRole('textbox', { name: '태그 폴더 이름', exact: true });
  const save = dialog.getByRole('button', { name: '저장', exact: true });
  assert.equal(await nameInput.inputValue(), second);
  await nameInput.fill(first);
  await save.click();
  await dialog.getByRole('alert').getByText('이미 사용 중인 태그 폴더 이름입니다.').waitFor();
  await nameInput.fill(renamed);
  await dialog.getByRole('button', { name: '폴더 아이콘 색상', exact: true }).click();
  await page.getByRole('dialog', { name: '폴더 아이콘 색상', exact: true })
    .getByRole('button', { name: '#a855f7', exact: true }).click();
  await page.screenshot({ path: join(output, 'edit-dialog.png'), animations: 'disabled' });
  cleanup.add(renamed);
  await save.click();
  await dialog.waitFor({ state: 'hidden' });
  await Promise.all([waitForOrder(page, [renamed, first, last]), waitForOrder(observer, [renamed, first, last])]);
  assert.equal(await toggle(page, renamed).getAttribute('aria-expanded'), 'false');
  assert.equal(await toggle(observer, renamed).getAttribute('aria-expanded'), 'false');

  await arrow(page, renamed, '아래로').click();
  await waitForOrder(page, [first, renamed, last]);
  await page.reload();
  await waitForOrder(page, [first, renamed, last]);
  assert.equal(await toggle(page, renamed).getAttribute('aria-expanded'), 'false');
  assert.equal(await folder(page, renamed).getByTestId('lnb-tag-folder-icon').evaluate((icon) => getComputedStyle(icon).color), 'rgb(168, 85, 247)');
  await toggle(page, renamed).click();
  await folder(page, renamed).getByText(fixtureTag, { exact: true }).waitFor();
  await page.screenshot({ path: join(output, 'sidebar.png'), clip: { x: 0, y: 0, width: 288, height: 620 }, animations: 'disabled' });
  const after = await (await request('/tag-folders')).json();
  assert.deepEqual(after, [before[0], { ...before[1], name: renamed, color: '#a855f7' }, before[2]]);

  const mobile = await browser.newContext({ locale: 'ko-KR', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await mobile.newPage();
  watch(phone);
  await phone.goto(origin);
  await phone.getByRole('button', { name: '메뉴 열기', exact: true }).tap();
  await arrow(phone, renamed, '위로').tap();
  await waitForOrder(phone, [renamed, first, last]);
  await editor(phone, renamed).tap();
  const phoneDialog = phone.getByRole('dialog', { name: '태그 폴더 수정', exact: true });
  await phoneDialog.getByRole('button', { name: '기본 색상', exact: true }).tap();
  await phoneDialog.getByRole('button', { name: '저장', exact: true }).tap();
  await phoneDialog.waitFor({ state: 'hidden' });
  assert.deepEqual((await (await request('/tag-folders')).json())[0], { ...before[1], name: renamed });
  await phone.screenshot({ path: join(output, 'touch-sidebar.png'), animations: 'disabled' });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ origin, passed: true, pageErrors: errors.length, artifacts: output }));
} finally {
  await browser.close();
  for (const name of cleanup) assert.equal((await request(`/tag-folders/${encodeURIComponent(name)}`, 'DELETE')).status, 200);
  await request(`/tags/${encodeURIComponent(fixtureTag)}`, 'DELETE');
}
