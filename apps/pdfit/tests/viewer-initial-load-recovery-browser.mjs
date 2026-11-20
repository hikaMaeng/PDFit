import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15235';
const output = process.env.PDFIT_TEST_OUTPUT ?? 'test/20261120/viewer-initial-load-recovery';
const folder = process.env.PDFIT_TEST_FOLDER ?? 'OutlineFixture';
const file = process.env.PDFIT_TEST_BOOK ?? 'original.pdf';
const suffix = `/${encodeURIComponent(folder)}/${encodeURIComponent(file)}`;
const pdf = `${origin}/api/folders/${encodeURIComponent(folder)}/files/${encodeURIComponent(file)}`;
await mkdir(output, { recursive: true });
assert.equal((await fetch(`${origin}/health`)).status, 200);
assert.equal((await fetch(pdf, { method: 'HEAD' })).status, 200);

const browser = await chromium.launch();
const results = [];
try {
  for (const name of ['automatic', 'manual', 'missing']) {
    const context = await browser.newContext({ locale: 'ko-KR', serviceWorkers: 'block' });
    const page = await context.newPage();
    const requests = [];
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await context.route('**/api/{viewer-state,progress}/**', (route) => route.request().method() === 'GET'
      ? route.continue() : route.fulfill({ json: { ok: true } }));

    let remainingFailures = name === 'automatic' ? 2 : Number.POSITIVE_INFINITY;
    await page.route(pdf, async (route) => {
      const method = route.request().method();
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        const status = name === 'missing' ? 404 : 503;
        requests.push({ method, status });
        await route.fulfill({ status, json: { code: 'LIBRARY_OFFLINE' } });
      } else {
        requests.push({ method, status: 'origin' });
        await route.continue();
      }
    });

    try {
      await page.goto(`${origin}/viewer${suffix}`, { waitUntil: 'domcontentloaded' });
      if (name === 'missing') {
        await page.getByText('문서를 열 수 없습니다.', { exact: false }).waitFor();
        assert.equal(await page.getByRole('button', { name: '다시 시도', exact: true }).count(), 0);
        assert.deepEqual(requests, [{ method: 'HEAD', status: 404 }]);
      } else {
        await page.getByText('PDF에 잠시 연결할 수 없습니다. 다시 시도 중…', { exact: true }).waitFor();
        if (name === 'automatic') {
          await page.screenshot({ path: join(output, 'retrying.png') });
        } else {
          const retry = page.getByRole('button', { name: '다시 시도', exact: true });
          await retry.waitFor({ timeout: 40_000 });
          assert.equal(requests.filter(({ status }) => status === 503).length, 6);
          await page.screenshot({ path: join(output, 'manual-retry.png') });
          remainingFailures = 0;
          await retry.click();
        }
        await page.getByRole('button', { name: '목차', exact: true }).waitFor({ timeout: 40_000 });
        await page.locator('canvas').first().waitFor({ timeout: 40_000 });
        assert.equal(await page.getByRole('alert').count(), 0);
        assert.ok(requests.filter(({ status }) => status === 503).every(({ method }) => method === 'HEAD'));
        assert.ok(requests.some(({ method, status }) => method === 'GET' && status === 'origin'));
        await page.screenshot({ path: join(output, `${name}-recovered.png`) });
      }
      assert.deepEqual(errors, []);
      results.push({ name, requests, errors });
      console.log(`PASS ${name}`);
    } catch (error) {
      results.push({ name, requests, errors, error: error.message });
      await page.screenshot({ path: join(output, `${name}-failure.png`) }).catch(() => undefined);
      throw error;
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  await writeFile(join(output, 'results.json'), JSON.stringify({ origin, results }, null, 2));
}
