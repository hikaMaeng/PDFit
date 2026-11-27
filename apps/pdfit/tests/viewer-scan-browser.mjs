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
  'Priority.pdf': ['', '', 'Second book tail'],
  'Parallel.pdf': Array.from({ length: 40 }, (_, index) => `Page ${index + 1}`),
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
  let activeLlmServerId;
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
      system: body.messages[0].role === 'system' ? body.messages[0].content : null,
      image: body.messages[0].content?.[1]?.image_url?.url.startsWith('data:image/jpeg;base64,') ?? false,
      respond(status = 200, content = 'Fixture vision text') {
        if (answered) return;
        answered = true;
        inFlight -= 1;
        res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify({
          choices: [{ message: { content }, finish_reason: 'stop' }],
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
  const coverage = (page) => page.getByRole('meter', { name: '스캔 완료 페이지 비율' });
  const shot = (page, filename) => page.screenshot({ path: path.join(output, filename), animations: 'disabled' });
  async function verifyStatusHeader(dialog) {
    const heading = dialog.getByRole('heading', { name: '스캔 상태', exact: true });
    const saved = dialog.getByText('텍스트 저장됨', { exact: true });
    const unsaved = dialog.getByText('저장된 텍스트 없음', { exact: true });
    const close = button(dialog, '닫기');
    const [headingBox, savedBox, unsavedBox, closeBox] = await Promise.all(
      [heading, saved, unsaved, close].map((locator) => locator.boundingBox()),
    );
    assert.ok(headingBox && savedBox && unsavedBox && closeBox);
    assert.ok(headingBox.x + headingBox.width <= savedBox.x && savedBox.x < unsavedBox.x && unsavedBox.x < closeBox.x);
    assert.ok(await heading.evaluate((element) => element.scrollWidth <= element.clientWidth));
    const centerY = (box) => box.y + box.height / 2;
    assert.ok([savedBox, unsavedBox, closeBox].every((box) => Math.abs(centerY(box) - centerY(headingBox)) <= 1));
    assert.equal(await close.textContent(), '');
    const inset = await close.evaluate((element) => {
      const header = element.closest('header');
      return {
        padding: getComputedStyle(header).paddingRight,
        distance: header.getBoundingClientRect().right - element.getBoundingClientRect().right,
      };
    });
    assert.deepEqual(inset, { padding: '5px', distance: 5 });
  }
  const expectCoverage = (page, percent) => until(
    () => coverage(page).filter({ hasText: new RegExp(`^${percent}%$`) }).count(),
    (count) => count === 1,
    `Toolbar shows ${percent}%`,
  );
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
    const limit = settings.getByRole('spinbutton', { name: 'AI 동시 요청 수' });
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
    await expectCoverage(mixed, 20);
    const scanButton = await button(mixed, '스캔 상태').boundingBox();
    const scanCoverage = await coverage(mixed).boundingBox();
    const scanInput = await startInput(mixed).boundingBox();
    const scanStart = await button(mixed, '시작').boundingBox();
    const contents = await mixed.getByTestId('viewer-outline-open').boundingBox();
    assert.ok(scanButton && scanCoverage && scanInput && scanStart && contents);
    assert.ok(scanButton.x < scanCoverage.x && scanCoverage.x < scanInput.x && scanInput.x < scanStart.x && scanStart.x < contents.x);
    assert.ok(Math.abs(scanButton.y - contents.y) < 4);
    const fontSize = (locator) => locator.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    assert.ok(await fontSize(coverage(mixed)) < await fontSize(startInput(mixed)));
    assert.ok(await fontSize(coverage(mixed)) < await fontSize(button(mixed, '시작')));
    await mixed.getByRole('toolbar').screenshot({ path: path.join(output, 'scan-toolbar.png') });
    await button(mixed, '스캔 상태').click();
    const initial = mixed.getByRole('dialog', { name: '스캔 상태', exact: true });
    const saved = initial.getByRole('listitem', { name: '2페이지, 텍스트 저장됨' });
    const unsaved = initial.getByRole('listitem', { name: '3페이지, 저장된 텍스트 없음' });
    await saved.waitFor();
    assert.equal(await initial.getByRole('listitem').count(), 5);
    await verifyStatusHeader(initial);
    assert.equal(await fontSize(saved), 10);
    assert.ok((await saved.boundingBox()).height <= 20);
    const color = (tile) => tile.evaluate((element) => getComputedStyle(element).backgroundColor);
    assert.notEqual(await color(saved), await color(unsaved));
    await button(initial, '닫기').click();
    await initial.waitFor({ state: 'hidden' });
    assert.equal(await button(mixed, '스캔 상태').evaluate((element) => element === document.activeElement), true);
    await shot(mixed, 'scan-idle.png');

    await start(mixed, 2);
    await calls(2);
    await progress(mixed, '2페이지 스캔 중').waitFor();
    const mixedSummary = button(mixed, '3,4 총 2건');
    await mixedSummary.click();
    const activeDialog = mixed.getByRole('dialog', { name: '진행 중인 페이지' });
    await activeDialog.getByRole('list').waitFor();
    assert.deepEqual(await activeDialog.getByRole('listitem').allTextContents(), ['3', '4']);
    await mixed.keyboard.press('Escape');
    await activeDialog.waitFor({ state: 'hidden' });
    assert.equal(await mixedSummary.evaluate((element) => element === document.activeElement), true);
    await expectCoverage(mixed, 20);
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
    await expectCoverage(other, 0);
    await start(other, 1);
    await progress(other, /스캔 대기 중/).waitFor();
    await other.close();
    assert.equal(outstanding.length, 2);
    outstanding[0].respond();
    await calls(3);
    const savedDuringScan = await pages('Mixed.pdf');
    assert.equal(savedDuringScan.length, 2);
    await expectCoverage(mixed, 40);
    const otherJob = await waitJob('Other.pdf', (value) => value.activePages.includes(1));
    const reopened = await viewer(context, 'Other.pdf', 'gpu');
    await progress(reopened, '1페이지 스캔 중').waitFor();
    assert.equal((await job('Other.pdf')).id, otherJob.id);
    await button(reopened, '취소').click();
    await waitJob('Other.pdf', (value) => value.status === 'cancelling');
    outstanding[2].respond();
    await waitJob('Other.pdf', (value) => value.status === 'cancelled');
    await expectCoverage(reopened, 25);
    await expectCoverage(mixed, 60);
    assert.ok((await pages('Mixed.pdf')).includes(4), 'The text-layer tail saved while the second vision request was held.');
    outstanding[1].respond();
    const completed = await waitJob('Mixed.pdf', (value) => value.status === 'completed');
    assert.equal(completed.processedPages, 4);
    assert.deepEqual(await pages('Mixed.pdf'), [1, 2, 3, 4]);
    await expectCoverage(mixed, 80);
    assert.deepEqual(await pages('Other.pdf'), [0]);
    assert.equal(peak, 2);
    assert.equal(outstanding.length, 3);
    steps.push('Two documents shared two slots; GPU viewer closed/reopened; cancellation drained its admitted page');

    await button(mixed, '스캔 상태').click();
    const complete = mixed.getByRole('dialog', { name: '스캔 상태', exact: true });
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
    await expectCoverage(failure, 33);
    await button(failure, '스캔 상태').click();
    const failureDialog = failure.getByRole('dialog', { name: '스캔 상태', exact: true });
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
    await expectCoverage(failure, 100);
    assert.equal(outstanding.length, 6);
    assert.ok(outstanding.every(({ model, image }) => model === 'vision-fixture' && image));
    steps.push('Vision failure stopped dispatch; one saved page was skipped on retry; stale cancel left the new job running');

    await mixed.setViewportSize({ width: 320, height: 730 });
    await button(mixed, '스캔 상태').click();
    const mobileStatus = mixed.getByRole('dialog', { name: '스캔 상태', exact: true });
    await mobileStatus.getByRole('listitem', { name: '5페이지, 텍스트 저장됨' }).waitFor();
    await verifyStatusHeader(mobileStatus);
    await shot(mixed, 'mobile-page-status.png');
    await button(mobileStatus, '닫기').click();
    const width = await mixed.getByRole('toolbar').evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
    assert.ok(width.scroll <= width.client, JSON.stringify(width));
    await expectCoverage(mixed, 80);
    await mixed.getByRole('toolbar').screenshot({ path: path.join(output, 'scan-toolbar-mobile.png') });
    assert.deepEqual(pageErrors, []);
    steps.push('Scan status put both legend labels and the X on the title row at 1280px and 320px, used 10px page numbers, and restored focus on close; the 320px toolbar fit');
    steps.push('Small whole-document coverage appears beside Scan before the start page and updates from saved pages at idle, during scans, after cancellation or failure, and at completion');

    const parallel = await context.newPage();
    parallel.on('pageerror', (error) => pageErrors.push(`Parallel.pdf: ${error.message}`));
    await parallel.setViewportSize({ width: 320, height: 730 });
    const sample = { id: 'layout-fixture', status: 'running', startPage: 1, pageCount: 40, activePages: [1], processedPages: 0 };
    let scanStatus = sample;
    await parallel.route('**/api/ocr/scan?*', (route) => route.fulfill({ json: { job: scanStatus } }));
    await parallel.goto(`${origin}/viewer/Scan/Parallel.pdf?engine=legacy`);
    const singleSummary = button(parallel, '1 총 1건');
    await singleSummary.waitFor();
    const singleBox = await singleSummary.boundingBox();
    assert.ok(singleBox);
    sample.activePages = [1, 2, 7, 9];
    const quartetSummary = button(parallel, '1,2… 총 4건');
    await quartetSummary.waitFor();
    await parallel.getByRole('toolbar').screenshot({ path: path.join(output, 'scan-active-summary.png') });
    await quartetSummary.focus();
    await parallel.keyboard.press('Enter');
    const parallelDialog = parallel.getByRole('dialog', { name: '진행 중인 페이지' });
    const tiles = parallelDialog.getByRole('listitem');
    await parallelDialog.getByRole('list', { name: '진행 중인 페이지' }).waitFor();
    assert.deepEqual(await tiles.allTextContents(), ['1', '2', '7', '9']);
    const square = await tiles.getByText('1', { exact: true }).boundingBox();
    assert.ok(square && Math.abs(square.width - square.height) <= 2);
    await shot(parallel, 'scan-active-page-modal.png');

    sample.activePages = Array.from({ length: 32 }, (_, index) => index + 9);
    await until(() => tiles.count(), (count) => count === 32, 'Open modal refreshes to 32 active pages');
    assert.deepEqual(await tiles.allTextContents(), sample.activePages.map(String));
    const dialogBox = await parallelDialog.boundingBox();
    assert.ok(dialogBox && dialogBox.width <= 272 && dialogBox.height <= 316);
    await tiles.getByText('40', { exact: true }).scrollIntoViewIfNeeded();
    const scrollBottom = await tiles.getByText('40', { exact: true }).boundingBox();
    assert.ok(scrollBottom && scrollBottom.y + scrollBottom.height <= dialogBox.y + dialogBox.height);
    await shot(parallel, 'scan-active-page-modal-scroll.png');
    await button(parallelDialog, '닫기').click();
    const manySummary = button(parallel, '9,10… 총 32건');
    await manySummary.waitFor();
    const manyBox = await manySummary.boundingBox();
    assert.equal(manyBox?.width, singleBox.width);
    assert.equal(manyBox?.height, singleBox.height);
    const activeWidth = await parallel.getByRole('toolbar').evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
    assert.ok(activeWidth.scroll <= activeWidth.client, JSON.stringify(activeWidth));
    await manySummary.click();
    scanStatus = null;
    await parallelDialog.getByRole('status').getByText('총 0건', { exact: true }).waitFor();
    assert.equal(await tiles.count(), 0);
    await button(parallelDialog, '닫기').click();
    await startInput(parallel).waitFor();
    await parallel.close();
    assert.deepEqual(pageErrors, []);
    steps.push('Synthetic status at 320px verified exact 1,2… 총 4건 text, keyboard opening, square live tiles, internal scrolling, identical summary size at 1 and 32 active pages, and empty tiles after job loss');

    await api(`${settingsUrl}/${activeServerId}`, 'DELETE');
    activeServerId = undefined;
    await api('/api/ocr/scan', 'POST', { folder: 'Scan', filename: 'Other.pdf', startPage: 2 }, 202);
    const unavailable = await waitJob('Other.pdf', (value) => value.status === 'failed');
    assert.equal(unavailable.failedPage, 2);
    assert.equal(unavailable.failure, 'unavailable');
    assert.deepEqual(await pages('Other.pdf'), [0]);
    steps.push('An image page without a configured vision server stops the document and preserves saved text');

    const priorityServer = await api(settingsUrl, 'POST', {
      name: 'Priority fixture', url: `http://${mockHost}:${vision.address().port}/v1`,
      models: { vision: 'vision-fixture' }, ocrConcurrency: 2,
    }, 201);
    activeServerId = priorityServer.id;
    const llmServer = await api(settingsUrl, 'POST', {
      name: 'Chat fixture', url: `http://${mockHost}:${vision.address().port}/v1/`,
      models: { llm: 'llm-fixture' }, ocrConcurrency: 3,
    }, 201);
    activeLlmServerId = llmServer.id;
    // The passive UI label translator has its own request path. Keep this scenario focused
    // on two model workers, two background documents and two foreground user actions.
    await context.route('**/api/settings/translations', (route) => route.fulfill({ json: { translations: route.request().postDataJSON().texts } }));
    const firstIndex = outstanding.length;
    await api('/api/ocr/scan', 'POST', { folder: 'Scan', filename: 'Other.pdf', startPage: 2 }, 202);
    await calls(firstIndex + 2);
    await api('/api/ocr/scan', 'POST', { folder: 'Scan', filename: 'Priority.pdf', startPage: 1 }, 202);
    await waitJob('Priority.pdf', (value) => value.pageCount === 3 && value.activePages.length === 0);

    await mixed.setViewportSize({ width: 1280, height: 900 });
    await button(mixed, 'Bot').click();
    const bot = mixed.getByRole('dialog', { name: 'Bot' });
    await bot.getByRole('textbox', { name: '질문' }).fill('이 책의 스캔 내용을 알려주세요.');
    await button(bot, '질문 보내기').click();
    await bot.getByRole('status').getByText('AI 작업 큐에서 대기 중…', { exact: true }).waitFor();
    await shot(mixed, 'bot-model-queued.png');

    const library = await context.newPage();
    library.on('pageerror', (error) => pageErrors.push(`Priority tag UI: ${error.message}`));
    await library.goto(`${origin}/folder/Scan`);
    await button(library, '표지 보기').click();
    const priorityCard = library.getByRole('article').filter({ has: library.getByRole('link', { name: 'Priority.pdf', exact: true }) });
    await priorityCard.getByTestId('pdf-cover-info-toggle').click();
    const tag = priorityCard.getByTestId('pdf-ai-auto-tag');
    await tag.click();
    await tag.getByRole('progressbar', { name: 'AI 작업 큐에서 대기 중…' }).waitFor({ timeout: 35_000 });
    assert.equal(outstanding.length, firstIndex + 2, 'Both interactive requests must wait for a running scan worker.');
    await library.mouse.move(0, 0);
    await tag.hover({ force: true });
    await shot(library, 'tag-model-queued.png');

    const { readServerSentData } = await import('../../../packages/pdfit/dist/common/protocol/server-sent-data.js');
    const translation = await fetch(`${origin}/api/settings/translations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/vnd.pdfit.ai-progress+event-stream' },
      body: JSON.stringify({ texts: ['Scan'], language: 'ko' }),
      signal: AbortSignal.timeout(20_000),
    });
    assert.match(translation.headers.get('content-type'), /^text\/event-stream/);
    const translationEvents = readServerSentData(translation.body);
    assert.deepEqual(JSON.parse((await translationEvents.next()).value), { type: 'progress', phase: 'queued' });

    outstanding[firstIndex].respond();
    await calls(firstIndex + 3);
    assert.equal(outstanding[firstIndex + 2].model, 'llm-fixture');
    assert.match(outstanding[firstIndex + 2].system, /Decide what source material/);
    await bot.getByRole('status').getByText('질문에 필요한 페이지를 찾는 중…', { exact: true }).waitFor();
    await shot(mixed, 'bot-model-analyzing.png');
    outstanding[firstIndex + 1].respond();
    await calls(firstIndex + 4);
    assert.equal(outstanding[firstIndex + 3].model, 'llm-fixture');
    await tag.getByRole('progressbar', { name: 'AI 모델의 응답을 기다리는 중…' }).waitFor();
    assert.equal(inFlight, 2);

    outstanding[firstIndex + 2].respond(200, '{"outlineKeys":[]}');
    await calls(firstIndex + 5);
    const answerStartedFirst = outstanding[firstIndex + 4].system?.includes("PDFit's reading companion");
    if (!answerStartedFirst) {
      assert.deepEqual(JSON.parse((await translationEvents.next()).value), { type: 'progress', phase: 'running' });
      await bot.getByRole('status').getByText('AI 작업 큐에서 대기 중…', { exact: true }).waitFor();
    }
    outstanding[firstIndex + 3].respond(200, '["컴퓨터 공학", "프로그래밍", "소프트웨어 공학", "알고리즘", "자료구조"]');
    await tag.getByRole('progressbar').waitFor({ state: 'hidden' });
    const assigned = await api('/api/tags/book/Scan/Priority.pdf');
    assert.ok(assigned.includes('프로그래밍'), JSON.stringify(assigned));
    await calls(firstIndex + 6);
    if (answerStartedFirst) {
      assert.deepEqual(JSON.parse((await translationEvents.next()).value), { type: 'progress', phase: 'running' });
    }
    const answerCall = outstanding[firstIndex + (answerStartedFirst ? 4 : 5)];
    assert.match(answerCall.system, /reading companion/);
    await bot.getByRole('status').getByText('답변을 생성하는 중…', { exact: true }).waitFor();
    await shot(mixed, 'bot-model-running.png');
    answerCall.respond(200, 'TITLE: Queue test\n우선순위 큐 응답입니다.');
    await bot.getByRole('log').getByText('우선순위 큐 응답입니다.', { exact: true }).waitFor();
    outstanding[firstIndex + (answerStartedFirst ? 5 : 4)].respond(200, '["스캔"]');
    assert.deepEqual(JSON.parse((await translationEvents.next()).value), { type: 'result', status: 200, body: { translations: ['스캔'] } });
    await translationEvents.return();
    await calls(firstIndex + 8);
    assert.ok(outstanding.slice(firstIndex + 6).every(({ image }) => image));
    outstanding[firstIndex + 6].respond();
    outstanding[firstIndex + 7].respond();
    await waitJob('Other.pdf', (value) => value.status === 'completed');
    await waitJob('Priority.pdf', (value) => value.status === 'completed');
    assert.deepEqual(await pages('Priority.pdf'), [0, 1, 2]);
    assert.equal(peak, 2);
    assert.deepEqual(pageErrors, []);
    steps.push('With two scans sharing two workers, chat and automatic tags waited in the AI queue, ran in arrival order before the next scan calls, and both documents finished at a peak of two');
    steps.push('Display translation waited in the same queue and emitted queued, running, and result events');
    console.log(JSON.stringify({ origin, peak, calls: outstanding.length, steps }, null, 2));
  } catch (error) {
    failureMessage = String(error);
    throw error;
  } finally {
    await writeFile(path.join(output, 'results.json'), JSON.stringify({ origin, peak, calls: outstanding.length, steps, pageErrors, failureMessage }, null, 2));
    for (const call of outstanding) call.respond(503);
    if (vision.listening) vision.close();
    await browser?.close();
    for (const id of [activeServerId, activeLlmServerId]) {
      if (id !== undefined) await api(`/api/settings/ai-servers/${id}`, 'DELETE');
    }
  }
}
