import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, utimes, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { buildPdf } from '../../../packages/pdfit/tests/fixtures/pdfFixture.mjs';

const fixtures = {
  'Mixed.pdf': ['Outside start', 'Seed text', '', '', 'Tail text'],
  'Other.pdf': ['', '', '', 'Finish text'],
  'Failure.pdf': ['', '', 'Blocked tail'],
};

if (process.argv[2] === '--fixtures') {
  const folder = path.join(process.argv[3], 'Scan');
  await mkdir(folder, { recursive: true });
  for (const [filename, labels] of Object.entries(fixtures)) {
    const target = path.join(folder, filename);
    await writeFile(target, buildPdf({ labels }));
    const modified = 1_700_000_000.00075;
    await utimes(target, modified, modified);
  }
} else {
  await verifyScan();
}

async function verifyScan() {
  const origin = process.env.PDFIT_TEST_ORIGIN;
  const output = process.env.PDFIT_TEST_OUTPUT;
  assert.ok(origin && output, 'Pass a dedicated fixture instance and evidence directory.');
  assert.equal(new URL(origin).hostname, '127.0.0.1', 'Use a local isolated fixture instance.');
  await mkdir(output, { recursive: true });
  const steps = [];
  const pageErrors = [];
  const outstanding = [];
  let inFlight = 0;
  let peak = 0;
  let activeServerId;
  let browser;
  let failureMessage;
  const vision = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404).end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    let answered = false;
    outstanding.push({
      model: body.model,
      image: body.messages[0].content[1].image_url.url.startsWith('data:image/jpeg;base64,'),
      respond(status = 200) {
        if (answered) return;
        answered = true;
        inFlight -= 1;
        res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify({
          choices: [{ message: { content: 'Fixture vision text' }, finish_reason: 'stop' }],
        }));
      },
    });
  });

  async function api(endpoint, method = 'GET', body, expected = 200) {
    const response = await fetch(new URL(endpoint, origin), {
      method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    assert.equal(response.status, expected, `${method} ${endpoint}: ${text}`);
    return text ? JSON.parse(text) : null;
  }
  const query = (filename) => new URLSearchParams({ folder: 'Scan', filename });
  const job = async (filename) => (await api(`/api/ocr/scan?${query(filename)}`)).job;
  const pages = async (filename) => (await api(`/api/ocr/scan/pages?${query(filename)}`)).pages;
  async function until(read, ready, label) {
    const deadline = Date.now() + 25_000;
    let value;
    while (Date.now() < deadline) {
      value = await read();
      if (ready(value)) return value;
      await delay(100);
    }
    assert.fail(`${label}: ${JSON.stringify(value)}`);
  }
  const waitJob = (filename, ready) => until(() => job(filename), (value) => value && ready(value), filename);
  const calls = (count) => until(() => outstanding.length, (value) => value >= count, `Vision calls ≥ ${count}`);
  const button = (page, name) => page.getByRole('button', { name, exact: true });
  const startInput = (page) => page.getByRole('spinbutton', { name: '스캔 시작 페이지' });
  const progress = (page, pattern) => page.getByRole('progressbar', { name: pattern });
  const shot = (page, filename) => page.screenshot({ path: path.join(output, filename), animations: 'disabled' });
  async function viewer(context, filename, engine = 'legacy', initialPage = 1) {
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(`${engine}/${filename}: ${error.message}`));
    await page.goto(`${origin}/viewer/Scan/${encodeURIComponent(filename)}?engine=${engine}&page=${initialPage}`);
    await button(page, '스캔 상태').waitFor();
    return page;
  }
  async function start(page, number) {
    await startInput(page).fill(String(number));
    await button(page, '시작').click();
  }

  try {
    await api('/health');
    assert.deepEqual(await api('/api/settings/ai-servers'), [], 'Start with a fresh fixture database.');
    for (const filename of Object.keys(fixtures)) assert.deepEqual(await pages(filename), []);

    vision.listen(0, '0.0.0.0');
    await once(vision, 'listening');
    const mockHost = process.env.PDFIT_TEST_DOCKER_HOST ?? 'host.docker.internal';
    const settingsUrl = '/api/settings/ai-servers';
    const server = await api(settingsUrl, 'POST', {
      name: 'Scan fixture', url: `http://${mockHost}:${vision.address().port}/v1`, models: { vision: 'vision-fixture' },
    }, 201);
    activeServerId = server.id;
    assert.equal((await api(settingsUrl))[0].ocrConcurrency, 1);
    await api(`${settingsUrl}/${activeServerId}`, 'PATCH', { ocrConcurrency: 0 }, 400);

    browser = await chromium.launch({ channel: process.env.PDFIT_TEST_CHANNEL ?? 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
    await context.addInitScript(() => {
      localStorage.setItem('pdfit.language', 'ko');
      localStorage.setItem('pdfit.color-mode', 'light');
    });
    const settings = await context.newPage();
    await settings.goto(`${origin}/settings`);
    const edit = settings.getByRole('row').filter({ hasText: 'Scan fixture' }).getByRole('button', { name: '수정' });
    await edit.click();
    const limit = settings.getByRole('spinbutton', { name: 'OCR 동시 요청 수' });
    assert.equal(await limit.inputValue(), '1');
    await limit.fill('2');
    await shot(settings, 'ocr-concurrency.png');
    await button(settings, '저장').click();
    await until(() => api(settingsUrl), (servers) => servers[0]?.ocrConcurrency === 2, 'OCR concurrency persisted');
    steps.push('Settings default 1, rejects 0, saved 2 from the UI');

    const initialRead = await api('/api/ocr/page', 'POST', { folder: 'Scan', filename: 'Mixed.pdf', pageIndex: 1 });
    assert.equal(initialRead.text, 'Seed text');
    assert.deepEqual(await pages('Mixed.pdf'), [1]);

    const mixed = await viewer(context, 'Mixed.pdf');
    const scanRight = await button(mixed, '스캔 상태').boundingBox();
    const contents = await mixed.getByTestId('viewer-outline-open').boundingBox();
    assert.ok(scanRight && contents && scanRight.x < contents.x && Math.abs(scanRight.y - contents.y) < 4);
    await button(mixed, '스캔 상태').click();
    const initial = mixed.getByRole('dialog', { name: '스캔 상태' });
    const saved = initial.getByRole('listitem', { name: '2페이지, 텍스트 저장됨' });
    const unsaved = initial.getByRole('listitem', { name: '3페이지, 저장된 텍스트 없음' });
    await saved.waitFor();
    assert.equal(await initial.getByRole('listitem').count(), 5);
    const color = (tile) => tile.evaluate((element) => getComputedStyle(element).backgroundColor);
    assert.notEqual(await color(saved), await color(unsaved));
    await button(initial, '닫기').click();
    await shot(mixed, 'scan-idle.png');

    await start(mixed, 2);
    await calls(2);
    await progress(mixed, /5페이지 중 3, 4페이지 스캔 중/).waitFor();
    assert.equal(await startInput(mixed).count(), 0);
    assert.equal(await button(mixed, '시작').count(), 0);
    const mixedJob = await job('Mixed.pdf');
    assert.deepEqual(mixedJob.activePages, [3, 4]);
    assert.equal(mixedJob.processedPages, 1);
    const duplicate = await api('/api/ocr/scan', 'POST', { folder: 'Scan', filename: 'Mixed.pdf', startPage: 5 }, 202);
    assert.equal(duplicate.job.id, mixedJob.id);
    await button(mixed, '다음 페이지').click();
    assert.equal(await mixed.getByRole('textbox', { name: '페이지 번호' }).inputValue(), '2');
    await shot(mixed, 'parallel-progress.png');
    steps.push('Two pages displayed together, DB index skipped, viewer navigated while OCR was held');

    const other = await viewer(context, 'Other.pdf', 'gpu');
    await start(other, 1);
    await progress(other, /스캔 대기 중/).waitFor();
    await other.close();
    assert.equal(outstanding.length, 2);
    outstanding[0].respond();
    await calls(3);
    const otherJob = await waitJob('Other.pdf', (value) => value.activePages.includes(1));
    const reopened = await viewer(context, 'Other.pdf', 'gpu');
    await progress(reopened, /4페이지 중 1페이지 스캔 중/).waitFor();
    assert.equal((await job('Other.pdf')).id, otherJob.id);
    await button(reopened, '취소').click();
    await waitJob('Other.pdf', (value) => value.status === 'cancelling');
    outstanding[2].respond();
    await waitJob('Other.pdf', (value) => value.status === 'cancelled');
    outstanding[1].respond();
    const completed = await waitJob('Mixed.pdf', (value) => value.status === 'completed');
    assert.equal(completed.processedPages, 4);
    assert.deepEqual(await pages('Mixed.pdf'), [1, 2, 3, 4]);
    assert.deepEqual(await pages('Other.pdf'), [0]);
    assert.equal(peak, 2);
    assert.equal(outstanding.length, 3);
    steps.push('Two documents shared two slots; GPU viewer closed/reopened; cancellation drained its admitted page');

    await button(mixed, '스캔 상태').click();
    const complete = mixed.getByRole('dialog', { name: '스캔 상태' });
    await complete.getByRole('listitem', { name: '5페이지, 텍스트 저장됨' }).waitFor();
    await complete.getByRole('listitem', { name: '1페이지, 저장된 텍스트 없음' }).waitFor();
    await shot(mixed, 'page-status.png');
    await button(complete, '닫기').click();

    const failure = await viewer(context, 'Failure.pdf');
    await start(failure, 1);
    await calls(5);
    outstanding[3].respond(502);
    const stopped = await waitJob('Failure.pdf', (value) => value.status === 'stopping');
    assert.equal(stopped.activePages.length, 1);
    outstanding[4].respond();
    const failed = await waitJob('Failure.pdf', (value) => value.status === 'failed');
    assert.equal(failed.failedPage, stopped.failedPage);
    const retained = await pages('Failure.pdf');
    assert.equal(retained.length, 1);
    assert.equal(retained[0], stopped.activePages[0] - 1);
    await button(failure, '스캔 상태').click();
    const failureDialog = failure.getByRole('dialog', { name: '스캔 상태' });
    await failureDialog.getByText(`${failed.failedPage}페이지에서 스캔이 중단됐습니다.`).waitFor();
    await shot(failure, 'scan-error.png');
    await button(failureDialog, '닫기').click();

    await api(`${settingsUrl}/${activeServerId}`, 'PATCH', { ocrConcurrency: 1 });
    await start(failure, 1);
    await calls(6);
    const resumed = await waitJob('Failure.pdf', (value) => value.id !== failed.id && value.activePages.length === 1);
    assert.deepEqual(resumed.activePages, [failed.failedPage]);
    assert.equal((await api('/api/ocr/scan/cancel', 'POST', { folder: 'Scan', filename: 'Failure.pdf', id: failed.id })).job.status, 'running');
    outstanding[5].respond();
    await waitJob('Failure.pdf', (value) => value.id === resumed.id && value.status === 'completed');
    assert.deepEqual(await pages('Failure.pdf'), [0, 1, 2]);
    assert.equal(outstanding.length, 6);
    assert.ok(outstanding.every(({ model, image }) => model === 'vision-fixture' && image));
    steps.push('Vision failure stopped dispatch; one saved page was skipped on retry; stale cancel left the new job running');

    await mixed.setViewportSize({ width: 320, height: 730 });
    await button(mixed, '스캔 상태').click();
    await mixed.getByRole('listitem', { name: '5페이지, 텍스트 저장됨' }).waitFor();
    await shot(mixed, 'mobile-page-status.png');
    await button(mixed.getByRole('dialog', { name: '스캔 상태' }), '닫기').click();
    const width = await mixed.getByRole('toolbar').evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
    assert.ok(width.scroll <= width.client, JSON.stringify(width));
    assert.deepEqual(pageErrors, []);
    steps.push('320px toolbar fits and the status dialog opens without browser page errors');

    await api(`${settingsUrl}/${activeServerId}`, 'DELETE');
    activeServerId = undefined;
    await api('/api/ocr/scan', 'POST', { folder: 'Scan', filename: 'Other.pdf', startPage: 2 }, 202);
    const unavailable = await waitJob('Other.pdf', (value) => value.status === 'failed');
    assert.equal(unavailable.failedPage, 2);
    assert.equal(unavailable.failure, 'unavailable');
    assert.deepEqual(await pages('Other.pdf'), [0]);
    steps.push('An image page without a configured vision server stops the document and preserves saved text');
    console.log(JSON.stringify({ origin, peak, calls: outstanding.length, steps }, null, 2));
  } catch (error) {
    failureMessage = String(error);
    throw error;
  } finally {
    await writeFile(path.join(output, 'results.json'), JSON.stringify({ origin, peak, calls: outstanding.length, steps, pageErrors, failureMessage }, null, 2));
    for (const call of outstanding) call.respond(503);
    if (vision.listening) vision.close();
    await browser?.close();
    if (activeServerId !== undefined) await api(`/api/settings/ai-servers/${activeServerId}`, 'DELETE');
  }
}
