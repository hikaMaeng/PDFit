import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const output = resolve(process.env.PDFIT_TEST_ARTIFACT_DIR ?? 'test/20261123/tag-original-display');
const tag = process.env.PDFIT_TEST_TAG ?? 'AI App';
const encode = encodeURIComponent;
const tagPath = `/tag/${encode(tag)}`;
const read = async (path) => {
  const response = await fetch(`${origin}/api${path}`);
  assert.ok(response.ok, `${path} returned ${response.status}`);
  return response.json();
};
const [tags, folders, books, index, libraryFolders] = await Promise.all([
  read('/tags'), read('/tag-folders'), read(`/tags/${encode(tag)}/books`), read('/tags/index'), read('/folders'),
]);
const group = folders.find(({ tags: members }) => members.includes(tag));
const groupedNames = new Set(folders.flatMap(({ tags: members }) => members));
const rootTag = tags.find((name) => !groupedNames.has(name));
const book = [...books].sort((a, b) => a.size - b.size)[0];
assert.ok(group && rootTag && book, 'Expected a grouped tag with a PDF and at least one ungrouped tag.');
const folderPath = `/folder/${encode(book.folder)}`;
const bookTags = await read(`/tags/book/${encode(book.folder)}/${encode(book.filename)}`);
const unassigned = tags.find((name) => !bookTags.includes(name));
assert.ok(unassigned, 'Expected a tag that the PDF does not already have.');
const browser = await chromium.launch({ headless: true, ...(process.env.PDFIT_TEST_CHANNEL ? { channel: process.env.PDFIT_TEST_CHANNEL } : {}) });
const results = { checks: [], requests: [], indexTagCount: index.length, errors: [] };
await mkdir(output, { recursive: true });

async function session(language) {
  const context = await browser.newContext({ locale: language === 'ko' ? 'ko-KR' : 'en-US', viewport: { width: 1440, height: 950 } });
  await context.addInitScript((lang) => {
    localStorage.setItem('pdfit.language', lang);
    localStorage.setItem('pdfit.library.view', 'list');
  }, language);
  await context.route('**/api/settings/ai-servers', (route) => route.fulfill({ json: [{ models: { llm: 'test' } }] }));
  await context.route('**/api/settings/translations', (route) => {
    const { texts } = route.request().postDataJSON();
    results.requests.push({ language, texts });
    return route.fulfill({ json: { translations: texts.map((value) => `Translated: ${value}`) } });
  });
  await context.route(/\/api\/(tags|tag-folders)(\/|$)/, (route) => {
    if (['GET', 'HEAD'].includes(route.request().method())) return route.fallback();
    results.errors.push(`Unexpected tag mutation: ${route.request().method()} ${route.request().url()}`);
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => results.errors.push(error.message));
  return page;
}

async function original(label, locator, value) {
  await locator.waitFor({ state: 'visible' });
  assert.equal(await locator.textContent(), value, label);
  assert.equal(await locator.evaluate((element) => element.translate), false, label);
  results.checks.push(label);
}

const chip = (area) => area.getByTestId('pdf-tag-chip').and(area.getByTitle(tag, { exact: true })).first();
async function goto(page, path) {
  await page.goto(`${origin}${path}`, { waitUntil: 'domcontentloaded' });
}

async function option(page, dialog, value, label) {
  const input = dialog.getByRole('combobox', { name: '태그 추가' });
  await input.fill(value);
  await original(label, page.getByRole('option', { name: value, exact: true }), value);
  await input.fill('');
}

try {
  const page = await session('ko');
  await goto(page, tagPath);
  const sidebar = page.getByTestId('lnb-tag-folders');
  const groupButton = sidebar.getByRole('button', { name: group.name, exact: true });
  await original('tag folder', groupButton.getByText(group.name, { exact: true }), group.name);
  if (await groupButton.getAttribute('aria-expanded') === 'false') await groupButton.click();
  const groupedRow = sidebar.getByTestId('lnb-folder-tag-row').filter({ has: page.getByText(tag, { exact: true }) });
  await original('grouped sidebar tag', groupedRow.getByText(tag, { exact: true }), tag);
  const rootRow = page.getByTestId('lnb-tag-row').filter({ has: page.getByText(rootTag, { exact: true }) });
  await original('ungrouped sidebar tag', rootRow.getByText(rootTag, { exact: true }), rootTag);
  await rootRow.getByRole('button', { name: '태그 폴더로 이동' }).click();
  const folderOption = page.getByRole('menuitem', { name: group.name, exact: true }).getByText(group.name, { exact: true });
  await original('tag folder menu', folderOption, group.name);
  await page.keyboard.press('Escape');
  const editButton = groupedRow.getByRole('button', { name: `태그 ${tag} 수정`, exact: true });
  await editButton.focus();
  const editHint = page.getByRole('tooltip').getByText(`태그 ${tag} 수정`, { exact: true });
  await original('edit tooltip', editHint, `태그 ${tag} 수정`);
  await editButton.press('Enter');
  const editor = page.getByRole('dialog', { name: '태그 수정' });
  assert.equal(await editor.getByRole('textbox', { name: '태그 이름' }).inputValue(), tag);
  results.checks.push('editor name input');
  await editor.getByRole('button', { name: '취소' }).click();
  await editor.waitFor({ state: 'hidden' });
  await groupedRow.getByRole('button', { name: '태그 삭제', exact: true }).click();
  const confirmation = page.getByRole('dialog');
  const message = confirmation.getByText(`태그 "${tag}"를 PDF ${books.length}개에서 삭제할까요?`, { exact: true });
  await original('delete confirmation', message, `태그 "${tag}"를 PDF ${books.length}개에서 삭제할까요?`);
  await confirmation.getByRole('button', { name: '취소' }).click();
  await original('tag detail heading', page.getByTestId('tag-title-row').getByRole('heading'), tag);
  await original('tag detail list chip', chip(page.getByTestId('pdf-tag-values')), `#${tag}`);
  await page.getByRole('button', { name: '표지 보기' }).click();
  const card = page.getByTestId('pdf-cover-card').filter({ has: page.getByTitle(book.filename, { exact: true }) });
  await card.getByTestId('pdf-cover-info-toggle').click();
  await original('cover overlay chip', chip(card), `#${tag}`);
  await page.screenshot({ path: resolve(output, 'sidebar-cover.png'), animations: 'disabled' });
  await card.getByRole('button', { name: '태그관리', exact: true }).click();
  const tagDialog = page.getByRole('dialog');
  await original('tag detail management chip', chip(tagDialog), `# ${tag}`);
  await option(page, tagDialog, unassigned, 'tag detail management option');
  await page.keyboard.press('Escape');
  await tagDialog.getByRole('button', { name: '닫기', exact: true }).click();

  await goto(page, '/tag-index');
  const indexHeading = page.getByTestId('tag-index-card-title').getByRole('heading', { name: tag, exact: true });
  await original('tag index card heading', indexHeading, tag);
  const indexHeadings = page.getByTestId('tag-index-card-title').getByRole('heading');
  assert.deepEqual(await indexHeadings.evaluateAll((headings) =>
    headings.map((heading) => ({ name: heading.textContent, translate: heading.translate })).sort((a, b) => a.name.localeCompare(b.name))),
  index.map(({ name }) => ({ name, translate: false })).sort((a, b) => a.name.localeCompare(b.name)));
  results.checks.push('all index labels match the API');
  await goto(page, folderPath);
  const folderToolbar = page.getByTestId('folder-list-toolbar');
  await folderToolbar.getByRole('button', { name: '목록 보기' }).click();
  await original('library folder list chip', chip(page.getByTestId('pdf-tag-values')), `#${tag}`);
  await folderToolbar.getByTestId('pdf-select-all').getByRole('checkbox').check();
  await page.getByTestId('bulk-manual-tag-management').click();
  await option(page, page.getByRole('dialog'), tag, 'bulk management option');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').getByRole('button', { name: '닫기', exact: true }).click();
  await folderToolbar.getByTestId('pdf-select-all').getByRole('checkbox').uncheck();
  await folderToolbar.getByRole('button', { name: '표지 보기' }).click();
  const folderCard = page.getByTestId('pdf-cover-card').filter({ has: page.getByTitle(book.filename, { exact: true }) });
  await folderCard.getByRole('button', { name: '태그관리', exact: true }).click();
  await original('library folder management chip', chip(page.getByRole('dialog')), `# ${tag}`);
  await option(page, page.getByRole('dialog'), unassigned, 'library folder management option');

  await goto(page, `/search?q=${encode(book.filename.replace(/\.pdf$/i, ''))}`);
  const search = page.getByTestId('search-results-page');
  await search.getByRole('button', { name: '목록 보기' }).click();
  await original('search result chip', chip(search), `#${tag}`);
  await search.getByRole('button', { name: '태그관리', exact: true }).first().click();
  await original('search result management chip', chip(page.getByRole('dialog')), `# ${tag}`);
  await option(page, page.getByRole('dialog'), unassigned, 'search result management option');

  // Return the same existing book as a favorite without changing the account.
  await page.route('**/api/favorites', (route) => route.fulfill({ json: [{ folder: book.folder, filename: book.filename }] }));
  await page.route('**/api/favorites/books', (route) => route.fulfill({ json: [book] }));
  await goto(page, '/favorites');
  await page.getByTestId('favorites-title').waitFor();
  await original('favorite book chip', chip(page.getByTestId('pdf-tag-values')), `#${tag}`);
  await goto(page, '/untagged');
  await page.getByTestId('untagged-title').waitFor();
  assert.equal(await page.getByTestId('pdf-tag-chip').count(), 0);
  results.checks.push('untagged view has no tag chips');

  // The viewer can persist progress and outlines. Keep this regression read-only.
  await page.route('**/api/**', (route) => ['GET', 'HEAD'].includes(route.request().method())
    ? route.fallback() : route.fulfill({ json: { ok: true } }));
  await goto(page, `/viewer/${encode(book.folder)}/${encode(book.filename)}`);
  await original('viewer header chip', chip(page.getByTestId('viewer-header-tags')), `#${tag}`);

  const english = await session('en');
  await goto(english, tagPath);
  await original('English tag detail heading', english.getByTestId('tag-title-row').getByRole('heading'), tag);
  await original('English tag chip', chip(english.getByTestId('pdf-tag-values')), `#${tag}`);
  await goto(english, folderPath);
  await english.getByRole('heading', { name: `Translated: ${book.folder}`, exact: true }).waitFor();
  results.checks.push('ordinary folder translation remains active');

  assert.ok(results.requests.length > 0, 'At least one folder translation request is required.');
  const libraryFolderNames = new Set(libraryFolders.map(({ name }) => name));
  assert.ok(results.requests.every(({ texts }) => texts.every((name) => libraryFolderNames.has(name))), 'A non-library-folder label reached the translation API.');
  assert.ok(results.requests.every(({ texts }) => !texts.includes(tag)), 'The tag reached the translation API.');
  assert.deepEqual(results.errors, []);
  assert.deepEqual(await read(`/tags/book/${encode(book.folder)}/${encode(book.filename)}`), bookTags);
  console.log(`PASS ${results.checks.length} checks, ${results.requests.length} folder translation batches, 0 requests containing "${tag}"`);
} finally {
  await browser.close();
  await writeFile(resolve(output, 'result.json'), JSON.stringify(results, null, 2));
}
