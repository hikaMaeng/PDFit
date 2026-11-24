import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const output = resolve(process.env.PDFIT_TEST_ARTIFACT_DIR ?? 'test/tag-delete-active');
const tag = { id: 'tag-1', name: 'UI·UX', bookCount: 1, color: '#22c55e', icon: 'tag' };
const tagPath = '/tag/' + encodeURIComponent(tag.name);
const folder = { name: 'Test Library', pdfCount: 1, isRoot: true, color: '#3b82f6' };
const folderPath = '/folder/' + encodeURIComponent(folder.name);
const book = { folder: folder.name, filename: 'sample.pdf', size: 1024, modified_at: '2026-11-23T00:00:00Z', tags: [tag.name] };
const scenarios = [
  { id: 'desktop', trailingSlash: true },
  { id: 'mobile-grouped', mobile: true },
  { id: 'delayed-delete', delayed: true },
  { id: 'folders-retry', failHomeFolders: true },
  { id: 'rejected-delete', rejectDelete: true },
];
const results = [];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PDFIT_TEST_CHANNEL || undefined });

async function exercise(scenario) {
  const { id, trailingSlash, mobile, delayed, failHomeFolders, rejectDelete } = scenario;
  const result = { id, pageErrors: [], consoleErrors: [], deleteCalls: 0, folderFailures: 0 };
  results.push(result);
  const context = await browser.newContext({
    locale: 'ko-KR',
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    isMobile: mobile,
    hasTouch: mobile,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (error) => result.pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') result.consoleErrors.push(message.text());
  });

  let deleted = false;
  let foldersAvailable = !failHomeFolders;
  const started = Promise.withResolvers();
  const reply = Promise.withResolvers();
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = decodeURIComponent(url.pathname);
    const method = route.request().method();
    if (url.origin !== origin) return route.abort();
    if (method === 'DELETE' && path === '/api/tags/' + tag.name) {
      result.deleteCalls++;
      started.resolve();
      if (delayed) await reply.promise;
      if (rejectDelete) return route.fulfill({ status: 500, json: { error: 'fixture delete failed' } });
      deleted = true;
      return route.fulfill({ json: { ok: true } });
    }
    if (method !== 'GET' && method !== 'HEAD') return route.fulfill({ status: 405, json: {} });
    if (path === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
    if (path === '/api/folders') {
      if (deleted && !foldersAvailable) {
        result.folderFailures++;
        return route.fulfill({ status: 503, json: { error: 'fixture folders unavailable' } });
      }
      return route.fulfill({ json: [folder] });
    }
    if (path === '/api/tags/summary') return route.fulfill({ json: deleted ? [] : [tag] });
    if (path === '/api/tags/' + tag.name + '/books') return route.fulfill({ json: deleted ? [] : [book] });
    if (path === '/api/tags/untagged-count') return route.fulfill({ json: { count: Number(deleted) } });
    if (path === '/api/tags/untagged-books') return route.fulfill({ json: deleted ? [{ ...book, tags: [] }] : [] });
    if (path === '/api/tag-folders') return route.fulfill({
      json: mobile ? [{ id: 'e1000000-0000-4000-8000-000000000000', name: 'Fixture Group', color: null, tags: deleted ? [] : [tag.name] }] : [],
    });
    if (path === '/api/settings/translations') return route.fulfill({ json: { translations: [] } });
    return route.fulfill({ json: [] });
  });

  const main = page.getByRole('main');
  const sidebarUntagged = page.getByTestId('lnb-untagged');
  const count = page.getByTestId('lnb-untagged-count');
  const openMenu = () => page.getByRole('button', { name: '메뉴 열기', exact: true }).click();
  const screenshot = async (name) => {
    const path = resolve(output, id + '-' + name + '.png');
    await page.screenshot({ path, timeout: 6000 });
    (result.screenshots ??= []).push(path);
  };

  try {
    const initialUrl = origin + tagPath + (trailingSlash ? '/' : '');
    await page.goto(initialUrl, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('tag-title-row').getByText(tag.name, { exact: true }).waitFor();
    if (mobile) await openMenu();
    const row = page.getByTestId(mobile ? 'lnb-folder-tag-row' : 'lnb-tag-row').filter({ hasText: tag.name });
    assert.equal((await count.textContent()).trim(), '0');
    if (!mobile) await row.hover();
    await row.getByRole('button', { name: '태그 삭제', exact: true }).click();
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: '삭제', exact: true }) });
    await dialog.getByRole('button', { name: '삭제', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });

    if (rejectDelete) {
      await page.getByRole('alert').getByText('fixture delete failed', { exact: true }).waitFor();
      await row.waitFor();
      assert.equal(page.url(), initialUrl);
      assert.equal((await count.textContent()).trim(), '0');
      await screenshot('restored');
    } else if (delayed) {
      const timeout = AbortSignal.timeout(8000);
      await Promise.race([
        started.promise,
        new Promise((_, reject) => timeout.addEventListener('abort', () => reject(timeout.reason), { once: true })),
      ]);
      await page.getByRole('button', { name: '태그 인덱스 열기', exact: true }).click();
      await page.waitForURL(origin + '/tag-index');
      reply.resolve();
      await count.filter({ hasText: /^1$/ }).waitFor();
      assert.equal(page.url(), origin + '/tag-index');
      await row.waitFor({ state: 'hidden' });
      await screenshot('kept-route');
    } else {
      await page.waitForURL(origin + '/');
      await main.getByRole('heading', { level: 1 }).waitFor();
      await row.waitFor({ state: 'hidden' });
      const tagIndex = main.getByRole('link', { name: '태그 인덱스 열기', exact: true });
      const library = main.getByRole('link', { name: '라이브러리 열기', exact: true });
      if (failHomeFolders) {
        const retry = main.getByRole('button', { name: '다시 시도', exact: true });
        await retry.waitFor();
        await tagIndex.click({ trial: true });
        await screenshot('retry');
        assert.equal(result.folderFailures, 1);
        foldersAvailable = true;
        await retry.click();
      }
      await library.waitFor();
      await screenshot('home');
      await library.click();
      await page.waitForURL(origin + folderPath);
      await page.goBack();
      await page.waitForURL(origin + '/');
      await tagIndex.click();
      await page.waitForURL(origin + '/tag-index');
      if (mobile) await openMenu();
      await count.filter({ hasText: /^1$/ }).waitFor();
      await sidebarUntagged.click();
      await page.waitForURL(origin + '/untagged');
      await page.getByTestId('tag-document-count').getByText('1개', { exact: true }).waitFor();
      await screenshot('untagged');
    }

    assert.equal(result.deleteCalls, 1);
    assert.deepEqual(result.pageErrors, []);
    const expectedHttpError = rejectDelete ? 500 : failHomeFolders ? 503 : undefined;
    assert.equal(result.consoleErrors.length, Number(expectedHttpError !== undefined));
    if (expectedHttpError) assert.match(result.consoleErrors[0], new RegExp(String(expectedHttpError)));
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed';
    result.failure = error.message;
    await screenshot('failed').catch(() => {});
  } finally {
    result.finalPath = new URL(page.url()).pathname;
    reply.resolve();
    await context.close();
    console.log(result.status.toUpperCase() + ' ' + id + (result.failure ? '\n' + result.failure : ''));
  }
}

try {
  for (const scenario of scenarios) await exercise(scenario);
} finally {
  await browser.close();
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ origin, results }, null, 2));
}
assert.equal(results.filter((result) => result.status === 'failed').length, 0, 'One or more tag deletion scenarios failed.');
