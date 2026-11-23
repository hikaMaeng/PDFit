import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const output = resolve(process.env.PDFIT_TEST_ARTIFACT_DIR ?? 'test/20261123/tag-management');
const fixtures = Array.from({ length: 12 }, (_, index) => `배치 ${String(index + 1).padStart(2, '0')}`);
const [first, second, third, fourth] = fixtures;
const typedTag = '직접 입력한 검증 태그';
const failedTag = '저장 실패 검증 태그';
const dialogName = '태그관리';
const recentName = '최근 추가한 태그';
const encode = encodeURIComponent;
const checks = [];
const errors = [];
const mutations = [];

async function read(path) {
  const response = await fetch(`${origin}/api${path}`);
  assert.ok(response.ok, `${path}: HTTP ${response.status}`);
  return response.json();
}

const sourceTag = process.env.PDFIT_TEST_TAG ?? 'AI App';
const tagPath = `/tag/${encode(sourceTag)}`;
const [book] = await read(`/tags/${encode(sourceTag)}/books`);
assert.ok(book, 'The source tag must have at least one book.');
const folderPath = `/folder/${encode(book.folder)}`;
const bookPath = `/tags/book/${encode(book.folder)}/${encode(book.filename)}`;
const originalTags = await read(bookPath);
const globalTags = await read('/tags');
const knownTags = new Set([...fixtures, ...globalTags]);
const applied = new Map();
const browser = await chromium.launch({ headless: true, channel: process.env.PDFIT_TEST_CHANNEL ?? 'chrome' });
await mkdir(output, { recursive: true });

async function session(viewport, touch = false) {
  const context = await browser.newContext({ locale: 'ko-KR', colorScheme: 'dark', viewport, isMobile: touch, hasTouch: touch });
  await context.addInitScript((view) => {
    localStorage.setItem('pdfit.language', 'ko');
    localStorage.setItem('pdfit.library.view', view);
  }, touch ? 'covers' : 'list');
  await context.route('**/api/tags', (route) => route.fulfill({ json: [...knownTags] }));
  await context.route('**/api/tags/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (method === 'GET' && path.startsWith('/api/tags/book/') && applied.has(path)) {
      const actual = await route.fetch();
      return route.fulfill({ response: actual, json: [...new Set([...await actual.json(), ...applied.get(path)])] });
    }
    if (method === 'GET') return route.fallback();
    if (method === 'PATCH' && path.endsWith('/color')) return route.fulfill({ json: { ok: true } });
    assert.ok(method === 'POST' && path.startsWith('/api/tags/book/'), `Unexpected mutation ${method} ${path}`);
    const { tag } = request.postDataJSON();
    mutations.push(tag);
    if (tag === failedTag) return route.fulfill({ status: 422, json: { error: failedTag } });
    knownTags.add(tag);
    applied.set(path, new Set([...(applied.get(path) ?? []), tag]));
    return route.fulfill({ json: { ok: true } });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('422')) errors.push(message.text());
  });
  return page;
}

function controls(page) {
  const dialog = page.getByRole('dialog', { name: dialogName });
  return {
    dialog,
    input: dialog.getByRole('combobox', { name: '태그 추가' }),
    recent: dialog.getByRole('group', { name: recentName }),
    option: (tag) => page.getByRole('option', { name: tag, exact: true }),
    chip: (tag) => dialog.getByTestId('pdf-tag-chip').and(dialog.getByTitle(tag, { exact: true })),
  };
}

async function openBook(page, path, filename = book.filename, touch = false) {
  await page.goto(`${origin}${path}`, { waitUntil: 'domcontentloaded' });
  const row = touch
    ? page.getByTestId('pdf-cover-card').filter({ has: page.getByTitle(filename, { exact: true }) })
    : page.getByRole('listitem').filter({ has: page.getByRole('link', { name: filename, exact: true }) });
  const manage = row.getByRole('button', { name: dialogName, exact: true });
  await (touch ? manage.tap() : manage.click());
  const ui = controls(page);
  await ui.input.waitFor();
  return ui;
}

async function expectRecent({ recent }, tags) {
  await recent.getByRole('button', { name: tags[0], exact: true }).waitFor();
  assert.deepEqual(await recent.getByRole('button').allTextContents(), tags);
}

async function expectGrid(page, input, recent) {
  await input.fill('배치');
  const list = page.getByRole('listbox');
  const options = list.getByRole('option');
  await options.first().waitFor();
  const rendered = await options.evaluateAll((elements) => elements.map((element) => {
    const { left, right, top, bottom } = element.getBoundingClientRect();
    return { name: element.textContent, left, right, top, bottom };
  }));
  assert.equal(await list.evaluate((element) => element.scrollWidth <= element.clientWidth), true);
  assert.ok(rendered.every(({ name }) => fixtures.includes(name)));
  assert.deepEqual(rendered.map(({ name }) => name), fixtures.filter((tag) => rendered.some(({ name }) => name === tag)));
  assert.ok(rendered.length > 4);
  assert.equal(new Set(rendered.slice(0, 4).map(({ top }) => top)).size, 1);
  for (let index = 1; index < 4; index += 1) assert.ok(rendered[index - 1].right <= rendered[index].left);
  assert.equal(rendered[4].left, rendered[0].left);
  assert.ok(rendered[4].top >= rendered[0].bottom);
  assert.ok(rendered[3].right <= (await page.evaluate(() => innerWidth)));
  if (recent) {
    const recentBox = await recent.boundingBox();
    const inputBox = await input.boundingBox();
    const popup = await list.boundingBox();
    assert.ok(recentBox.y >= inputBox.y + inputBox.height);
    assert.ok(popup.y >= recentBox.y + recentBox.height || popup.y + popup.height <= inputBox.y);
  }
}

try {
  const desktop = await session({ width: 1024, height: 850 });
  let ui = await openBook(desktop, folderPath);
  assert.equal(await ui.recent.count(), 0);
  await expectGrid(desktop, ui.input);
  await ui.input.press('ArrowDown');
  await ui.input.press('Enter');
  await ui.chip(first).waitFor();
  for (const tag of [second, third, fourth]) {
    await ui.input.fill(tag);
    await ui.option(tag).click();
    await ui.chip(tag).waitFor();
  }
  await expectRecent(ui, [fourth, third, second]);
  assert.equal(await ui.recent.getByRole('button', { name: fourth, exact: true }).isDisabled(), true);
  assert.deepEqual(mutations, [first, second, third, fourth]);
  checks.push('Folder list, four columns in row order, keyboard selection, 3 newest, assigned tag disabled');

  await ui.input.fill(failedTag);
  await ui.input.press('Enter');
  await desktop.getByText(`태그를 추가하지 못했습니다. ${failedTag}`, { exact: true }).waitFor();
  await expectRecent(ui, [fourth, third, second]);
  await ui.input.fill(typedTag);
  await ui.input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  assert.deepEqual(mutations, [first, second, third, fourth, failedTag]);
  await ui.input.press('Enter');
  await ui.chip(typedTag).waitFor();
  await expectRecent(ui, [typedTag, fourth, third]);
  checks.push('Failed add excluded, IME ignored, new tag recorded and displayed');

  ui = await openBook(desktop, tagPath);
  await expectRecent(ui, [typedTag, fourth, third]);
  await expectGrid(desktop, ui.input, ui.recent);
  await desktop.screenshot({ path: resolve(output, 'desktop.png'), animations: 'disabled' });
  ui = await openBook(desktop, `/search?q=${encode(book.filename.replace(/\.pdf$/i, ''))}`);
  await expectRecent(ui, [typedTag, fourth, third]);
  checks.push('History persists across page loads, tag and search entry points');

  const touch = await session({ width: 390, height: 824 }, true);
  ui = await openBook(touch, folderPath, book.filename, true);
  assert.equal(await ui.recent.count(), 0);
  await ui.input.fill(fixtures[5]);
  await ui.option(fixtures[5]).tap();
  await ui.chip(fixtures[5]).waitFor();
  const other = (await read(`/tags/${encode(sourceTag)}/books`)).find(({ folder, filename }) => folder !== book.folder || filename !== book.filename);
  assert.ok(other, 'The source tag must have a second book for recent-tag reuse.');
  ui = await openBook(touch, `/folder/${encode(other.folder)}`, other.filename, true);
  await expectRecent(ui, [fixtures[5]]);
  await expectGrid(touch, ui.input, ui.recent);
  await touch.screenshot({ path: resolve(output, 'touch.png'), animations: 'disabled' });
  await ui.recent.getByRole('button', { name: fixtures[5], exact: true }).tap();
  await ui.chip(fixtures[5]).waitFor();
  await expectRecent(ui, [fixtures[5]]);
  assert.equal(mutations.filter((tag) => tag === fixtures[5]).length, 2);
  checks.push('390px touch cover, 4 columns, direct reuse while popup open, deduplication and isolated browser history');

  await desktop.goto(`${origin}${folderPath}`, { waitUntil: 'domcontentloaded' });
  const toolbar = desktop.getByTestId('folder-list-toolbar');
  await toolbar.getByTestId('pdf-select-all').getByRole('checkbox').check();
  await desktop.getByTestId('bulk-manual-tag-management').click();
  ui = controls(desktop);
  await expectRecent(ui, [typedTag, fourth, third]);
  await expectGrid(desktop, ui.input, ui.recent);
  await ui.option(first).click();
  assert.equal(await ui.input.inputValue(), first);
  checks.push('Bulk dialog shares history and four-column autocomplete');

  assert.deepEqual(errors, []);
  assert.deepEqual(await read(bookPath), originalTags);
  for (const check of checks) console.log(`PASS ${check}`);
} finally {
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ origin, checks, errors, mutations }, null, 2));
  await browser.close();
}
