import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const output = resolve(process.env.PDFIT_TEST_ARTIFACT_DIR ?? 'test/20261123/tag-editing');
await mkdir(output, { recursive: true });
const stamp = randomUUID().slice(0, 8);
const original = `편집 원본-${stamp}`;
const duplicate = `편집 중복-${stamp}`;
const updated = `편집 100% / 실습-${stamp}`;
const folderNames = [`편집 첫 폴더-${stamp}`, `편집 둘째 폴더-${stamp}`];
const encode = encodeURIComponent;
const tagUrl = (name) => `${origin}/tag/${encode(name)}`;
const tags = () => read('/tags/summary');
const folders = () => read('/tag-folders');

async function request(path, method = 'GET', body) {
  return fetch(`${origin}/api${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

async function read(path) {
  const response = await request(path);
  assert.ok(response.ok, `${path} returned ${response.status}`);
  return response.json();
}

const baseline = await tags();
const originalFolders = await folders();
const candidates = await read(`/tags/${encode(baseline[0].name)}/books`);
const example = candidates.sort((left, right) => left.size - right.size)[0];
assert.ok(example, 'A tagged PDF is required for the temporary relations.');
const bookPath = `/tags/book/${encode(example.folder)}/${encode(example.filename)}`;
const beforeBookTags = await read(bookPath);
const beforeUntagged = await read('/tags/untagged-count');
const browser = await chromium.launch({ headless: true, ...(process.env.PDFIT_TEST_CHANNEL ? { channel: process.env.PDFIT_TEST_CHANNEL } : {}) });
const errors = [];

try {
  for (const name of [original, duplicate]) assert.equal((await request(bookPath, 'POST', { tag: name })).status, 200);
  const initial = (await tags()).find(({ name }) => name === original);
  assert.equal(initial.icon, 'tag');
  const desktop = await browser.newContext({ locale: 'ko-KR', colorScheme: 'dark', viewport: { width: 1240, height: 900 } });
  await desktop.addInitScript(() => localStorage.setItem('pdfit.library.view', 'list'));
  const page = await desktop.newPage();
  const second = await desktop.newPage();
  const documents = await desktop.newPage();
  const viewer = await desktop.newPage();
  // Opening an existing PDF must not save viewer progress or an extracted outline during this test.
  await viewer.route('**/api/**', (route) => ['GET', 'HEAD'].includes(route.request().method())
    ? route.continue() : route.fulfill({ json: { ok: true } }));
  for (const tab of [page, second, documents, viewer]) tab.on('pageerror', (error) => errors.push(error.message));
  const editor = page.getByRole('dialog', { name: '태그 수정' });
  const edit = (row, name) => row.getByRole('button', { name: `태그 ${name} 수정`, exact: true });
  const nameInput = editor.getByRole('textbox', { name: '태그 이름' });
  const save = editor.getByRole('button', { name: '저장', exact: true });
  const iconChoices = editor.getByRole('group', { name: '태그 아이콘' }).getByRole('button');

  await page.goto(tagUrl(original), { waitUntil: 'domcontentloaded' });
  const originalRow = page.getByTestId('lnb-tag-row').filter({ hasText: original });
  await originalRow.getByTestId('lnb-tag-icon').waitFor();
  await edit(originalRow, original).focus();
  await edit(originalRow, original).press('Enter');
  await editor.waitFor();
  assert.equal(await nameInput.inputValue(), original);
  const icons = await iconChoices.evaluateAll((buttons) => buttons.map((button) => ({
    label: button.getAttribute('aria-label'),
    shape: button.querySelector('svg')?.innerHTML,
  })));
  assert.equal(icons.length, 48);
  assert.ok(icons.every(({ label, shape }) => label && shape));
  assert.equal(new Set(icons.map(({ label }) => label)).size, icons.length);
  assert.equal(new Set(icons.map(({ shape }) => shape)).size, icons.length);
  assert.equal(await editor.getByRole('button', { name: '기본 태그', exact: true }).getAttribute('aria-pressed'), 'true');
  await nameInput.fill(`${original} 취소`);
  await editor.getByRole('button', { name: '취소' }).click();
  await editor.waitFor({ state: 'hidden' });
  assert.equal(page.url(), tagUrl(original));
  assert.deepEqual((await tags()).find(({ id }) => id === initial.id), initial);
  console.log('PASS Keyboard editor and cancel');

  for (const name of folderNames) {
    assert.equal((await request('/tag-folders', 'POST', { name })).status, 201);
    assert.equal((await request(`/tag-folders/${encode(name)}/tags/${encode(original)}`, 'PUT')).status, 200);
  }
  await Promise.all([
    page.reload({ waitUntil: 'domcontentloaded' }),
    second.goto(tagUrl(original), { waitUntil: 'domcontentloaded' }),
    documents.goto(`${origin}/folder/${encode(example.folder)}`, { waitUntil: 'domcontentloaded' }),
    viewer.goto(`${origin}/viewer/${encode(example.folder)}/${encode(example.filename)}`, { waitUntil: 'domcontentloaded' }),
  ]);
  const folder = page.getByTestId('lnb-tag-folder').filter({ has: page.getByTestId('lnb-tag-folder-toggle').and(page.getByLabel(folderNames[0], { exact: true })) });
  const member = (name) => folder.getByTestId('lnb-folder-tag-row').filter({ hasText: name });
  await page.getByRole('heading', { name: original, exact: true }).waitFor();
  await second.getByRole('heading', { name: original, exact: true }).waitFor();
  const currentChip = documents.getByTestId('pdf-tag-chip').filter({ hasText: original });
  await currentChip.waitFor();
  const viewerTags = viewer.getByTestId('viewer-header-tags');
  await viewerTags.getByTestId('pdf-tag-chip').filter({ hasText: original }).waitFor();
  await edit(member(original), original).click();
  await nameInput.fill(duplicate);
  await editor.getByRole('button', { name: '로봇', exact: true }).press('Enter');
  await editor.getByRole('button', { name: '태그 색상', exact: true }).click();
  await page.getByRole('dialog', { name: '태그 색상' }).getByRole('button', { name: '#a855f7', exact: true }).click();
  await page.getByRole('dialog', { name: '태그 색상' }).waitFor({ state: 'hidden' });
  assert.equal(await editor.getByRole('button', { name: '로봇', exact: true }).getAttribute('aria-pressed'), 'true');
  const conflict = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().endsWith('/details'));
  await save.click();
  assert.equal((await conflict).status(), 409);
  await editor.getByRole('alert').getByText('이미 사용 중인 태그 이름입니다.').waitFor();
  assert.deepEqual((await tags()).find(({ id }) => id === initial.id), initial);
  await nameInput.fill(` ${updated} `);
  await page.screenshot({ path: resolve(output, 'edit-tag-dialog.png'), animations: 'disabled' });
  const response = page.waitForResponse((result) => result.request().method() === 'PATCH' && result.url().endsWith('/details'), { timeout: 10000 });
  await nameInput.press('Enter');
  const saved = await response;
  assert.equal(saved.status(), 200, await saved.text());
  await editor.waitFor({ state: 'hidden' });
  await Promise.all([page.waitForURL(tagUrl(updated)), second.waitForURL(tagUrl(updated))]);
  await second.getByRole('heading', { name: updated, exact: true }).waitFor();
  await page.getByRole('heading', { name: updated, exact: true }).waitFor();
  await page.getByTestId('tag-title-row').locator('[data-tag-icon="robot"]').waitFor();
  await member(updated).locator('[data-tag-icon="robot"]').waitFor();
  assert.equal(await member(updated).getByTestId('lnb-tag-icon').evaluate((icon) => getComputedStyle(icon).color), 'rgb(168, 85, 247)');
  await documents.getByTestId('pdf-tag-chip').filter({ hasText: updated }).waitFor();
  await currentChip.waitFor({ state: 'hidden' });
  await viewerTags.getByTestId('pdf-tag-chip').filter({ hasText: updated }).waitFor();
  assert.equal(await page.getByTestId('tag-document-count').textContent(), '1개');
  assert.deepEqual((await tags()).find(({ id }) => id === initial.id), { ...initial, name: updated, icon: 'robot', color: '#a855f7' });
  assert.deepEqual((await folders()).filter(({ name }) => folderNames.includes(name)).map(({ tags }) => tags), [[updated], [updated]]);
  assert.deepEqual((await read(`/tags/${encode(updated)}/books`)).map(({ filename }) => filename), [example.filename]);
  assert.deepEqual(await read(`/tags/${encode(original)}/books`), []);
  assert.deepEqual(await read('/tags/untagged-count'), beforeUntagged);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('tag-title-row').locator('[data-tag-icon="robot"]').waitFor();
  await member(updated).locator('[data-tag-icon="robot"]').waitFor();
  await member(updated).scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, 'tag-renamed.png'), animations: 'disabled' });
  await page.getByRole('button', { name: '태그 인덱스 열기' }).click();
  const card = page.getByTestId('tag-index-card').filter({ has: page.getByRole('link', { name: `태그 ${updated} 열기`, exact: true }) });
  await card.locator('[data-tag-icon="robot"]').waitFor();
  console.log('PASS 48 unique labelled glyphs, keyboard selection, duplicate rollback, two tabs, PDF viewer, reload, and index');

  const touch = await browser.newContext({ locale: 'ko-KR', colorScheme: 'light', viewport: { width: 390, height: 640 }, isMobile: true, hasTouch: true });
  const mobile = await touch.newPage();
  mobile.on('pageerror', (error) => errors.push(error.message));
  await mobile.goto(tagUrl(updated), { waitUntil: 'domcontentloaded' });
  await mobile.getByRole('heading', { name: updated, exact: true }).waitFor();
  const refresh = await mobile.getByTestId('tag-refresh').boundingBox();
  assert.ok(refresh && refresh.height < 45, 'A long tag name must not wrap the refresh button vertically.');
  await mobile.getByRole('button', { name: '메뉴 열기' }).tap();
  const mobileRow = mobile.getByTestId('lnb-tag-folder').filter({ has: mobile.getByRole('button', { name: folderNames[0], exact: true }) })
    .getByTestId('lnb-folder-tag-row').filter({ hasText: updated });
  const touchEdit = edit(mobileRow, updated);
  await touchEdit.waitFor();
  assert.ok(Number(await touchEdit.evaluate((button) => getComputedStyle(button).opacity)) > 0);
  await touchEdit.tap();
  const mobileEditor = mobile.getByRole('dialog', { name: '태그 수정' });
  await mobileEditor.waitFor();
  await mobile.screenshot({ path: resolve(output, 'touch-tag-dialog.png'), animations: 'disabled' });
  await mobileEditor.getByRole('button', { name: '취소' }).tap();
  await mobileEditor.waitFor({ state: 'hidden' });
  await touchEdit.tap();
  const lastIcon = mobileEditor.getByRole('button', { name: '우주', exact: true });
  await lastIcon.tap();
  assert.equal(await lastIcon.getAttribute('aria-pressed'), 'true');
  await mobile.screenshot({ path: resolve(output, 'touch-tag-dialog-last-icon.png'), animations: 'disabled' });
  const touchResponse = mobile.waitForResponse((result) => result.request().method() === 'PATCH' && result.url().endsWith('/details'));
  await mobileEditor.getByRole('button', { name: '저장', exact: true }).tap();
  assert.equal((await touchResponse).status(), 200);
  await mobileEditor.waitFor({ state: 'hidden' });
  await mobileRow.locator('[data-tag-icon="space"]').waitFor();
  assert.deepEqual((await tags()).find(({ id }) => id === initial.id), { ...initial, name: updated, icon: 'space', color: '#a855f7' });
  assert.deepEqual(errors, []);
  console.log('PASS Touch editor, cancel, and icon-only save, no page errors');
} finally {
  await browser.close();
  for (const name of folderNames) await request(`/tag-folders/${encode(name)}`, 'DELETE');
  for (const name of [original, updated, duplicate]) assert.equal((await request(`/tags/${encode(name)}`, 'DELETE')).status, 200);
  assert.deepEqual(await read(bookPath), beforeBookTags);
  assert.ok(!(await tags()).some(({ name }) => [original, updated, duplicate].includes(name)));
  assert.ok(!(await folders()).some(({ name }) => folderNames.includes(name)));
  assert.deepEqual(originalFolders.filter(({ name }) => folderNames.includes(name)), []);
  console.log('PASS Temporary tag and folder cleanup');
}
