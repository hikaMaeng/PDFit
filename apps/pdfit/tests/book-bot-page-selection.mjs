import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const { PDFIT_TEST_ORIGIN: origin, PDFIT_TEST_CONTAINER: container, PDFIT_TEST_PROJECT: project } = process.env;
assert.ok(origin && new URL(origin).hostname === '127.0.0.1' && new URL(origin).port !== '15203');
assert.ok(project?.startsWith('pdfit-bot-pages-') && container === project + '-pdfit-1');
const identity = spawnSync('docker', ['inspect', container, '--format', '{{index .Config.Labels "com.docker.compose.project"}}'], { encoding: 'utf8' });
assert.equal(identity.stdout.trim(), project);

function sql(statement) {
  const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-XAt', '-U', 'books', '-d', 'books', '-v', 'ON_ERROR_STOP=1'], {
    input: statement, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

const bookQuery = new URLSearchParams({ folder: 'Scan', filename: 'Parallel.pdf' });
const outline = [
  { key: '0', title: 'Chapter 1', depth: 0, page: 1 },
  { key: '1', title: 'Chapter 4', depth: 0, page: 8 },
  { key: '1.0', title: 'Details', depth: 1, page: 12 },
  { key: '2', title: 'Chapter 5', depth: 0, page: 22 },
];

async function send(path, method = 'GET', body, expected = 200, headers = {}) {
  const response = await fetch(origin + path, {
    method, signal: AbortSignal.timeout(25_000), body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...headers },
  });
  const data = await response.text();
  assert.equal(response.status, expected, data);
  return data;
}

assert.deepEqual(JSON.parse(await send('/api/settings/ai-servers')), []);
await send('/api/outlines/Scan/Parallel.pdf', 'PUT', { entries: outline });
assert.match(sql(`INSERT INTO book_page_ocr_search (folder,filename,page_index,source_size,source_modified_at,body)
SELECT folder, filename, i, size, CASE WHEN i = 11 THEN 'stale-version' ELSE modified_at END,
'Synthetic OCR marker ' || (i+1) FROM books CROSS JOIN generate_series(0,39) AS i
WHERE folder='Scan' AND filename='Parallel.pdf'
ON CONFLICT (folder,filename,page_index) DO UPDATE SET source_modified_at=EXCLUDED.source_modified_at, body=EXCLUDED.body;`), /INSERT 0 40/);

const calls = [];
let holdBrowserStages = false;
const browserPlan = Promise.withResolvers();
const browserFirstDelta = Promise.withResolvers();
const browserFinalDelta = Promise.withResolvers();
const upstream = createServer(async (req, res) => {
  const data = [];
  for await (const chunk of req) data.push(chunk);
  const { messages } = JSON.parse(Buffer.concat(data));
  const context = JSON.parse(messages[1].content);
  const emit = (content) => 'data: ' + JSON.stringify({ choices: [{ delta: { content }, index: 0 }] }) + '\n\n';
  const done = 'data: {"choices":[{"index":0,"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
  res.setHeader('Content-Type', 'text/event-stream');
  if (messages[0].content.startsWith('Translate each JSON array item')) {
    res.end(emit(JSON.stringify(context)) + done);
    return;
  }
  calls.push({ context, userMessage: messages[2] });
  if (!context.evidence) {
    if (holdBrowserStages) await browserPlan.promise;
    const outlineKeys = context.question === 'Summarize chapter four' ? ['1'] : [];
    const historySummary = messages[0].content.includes('rolling summary')
      ? (context.history.summary ? 'SECOND INTERNAL SUMMARY' : 'FIRST INTERNAL SUMMARY') : undefined;
    res.write(emit(JSON.stringify({ outlineKeys, historySummary })));
  } else {
    res.write(emit(messages[0].content.includes('Start with exactly one line')
      ? 'TITLE: Fixture\nFirst fragment. ' : 'First fragment. '));
    if (holdBrowserStages) {
      browserFirstDelta.resolve();
      await browserFinalDelta.promise;
    }
    res.write(emit('Second fragment.'));
  }
  res.end(done);
});
upstream.listen(0, '0.0.0.0');
await once(upstream, 'listening');
let serverId;
try {
  const server = JSON.parse(await send('/api/settings/ai-servers', 'POST', {
    name: 'Book Bot test', url: 'http://host.docker.internal:' + upstream.address().port + '/v1',
    models: { llm: 'qwen36-35b' }, ocrConcurrency: 2, botContextTokens: 150_000,
  }, 201));
  serverId = server.id;
  const sessionId = randomUUID();
  const sessions = '/api/book-bot/sessions?' + bookQuery + '&id=' + sessionId;
  const opened = JSON.parse(await send(sessions, 'POST', undefined, 201));
  assert.deepEqual(opened.context, { title: 'Parallel', outline });
  assert.deepEqual(opened.session.turns, []);
  assert.equal(calls.length, 0);

  const postTurn = (data) => send('/api/book-bot/turns?' + bookQuery, 'POST', { ...data, sessionId }, 200,
    { Accept: 'text/event-stream', 'X-PDFit-Bot-Progress': '3' }).then((stream) =>
    stream.split('\n').filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice(6))));

  const first = { turnId: randomUUID(), revision: 0, question: 'Summarize chapter four' };
  const events = await postTurn(first);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].context, { book: opened.context, history: { summary: null, turns: [] }, question: first.question });
  assert.equal(calls[0].userMessage, undefined);
  assert.deepEqual(calls[1].context.book, opened.context);
  assert.equal(calls[1].context.question, undefined);
  assert.deepEqual(calls[1].userMessage, { role: 'user', content: first.question });
  const wantedPages = Array.from({ length: 14 }, (_, i) => i + 8).filter((page) => page !== 12);
  assert.deepEqual(calls[1].context.evidence.pages.map(({ page }) => page), wantedPages);
  assert.deepEqual(events.filter(({ type }) => type === 'progress').map(({ phase }) => phase),
    ['preparing', 'analyzing', 'loadingPages', 'generating', 'saving']);
  assert.deepEqual(events.filter(({ type }) => type === 'delta').map(({ text }) => text), ['First fragment. ', 'Second fragment.']);
  assert.equal(events.at(-1).revision, 1);
  assert.deepEqual(Object.keys(events.at(-1).turn), ['id', 'question', 'answer']);
  assert.equal((await postTurn(first)).at(-1).revision, 1);
  assert.equal(calls.length, 2);
  const firstSaved = JSON.parse(sql(`SELECT turns->0 FROM book_bot_sessions WHERE id='${sessionId}';`));
  assert.deepEqual(firstSaved.addedPages.map(({ page }) => page), wantedPages);

  // Seed the token accounting above 80% without sending a 120,000-token fixture.
  const markLarge = (index) => sql(`UPDATE book_bot_sessions SET turns =
    jsonb_set(turns, '{${index},addedPages}', '[{"page":8,"tokens":120001}]'::jsonb) WHERE id='${sessionId}';`);
  markLarge(0);
  assert.equal((await postTurn({ turnId: randomUUID(), revision: 1, question: 'What have we discussed?' })).at(-1).revision, 2);
  assert.equal(calls[2].context.history.turns[0].question, first.question);
  assert.deepEqual(calls[3].context.history, { summary: 'FIRST INTERNAL SUMMARY', turns: [] });
  assert.deepEqual(calls[3].context.evidence.pages, []);
  markLarge(1);
  assert.equal((await postTurn({ turnId: randomUUID(), revision: 2, question: 'Continue' })).at(-1).revision, 3);
  assert.equal(calls[4].context.history.summary, 'FIRST INTERNAL SUMMARY');
  assert.deepEqual(calls[4].context.history.turns.map(({ question }) => question), ['What have we discussed?']);
  assert.deepEqual(calls[5].context.history, { summary: 'SECOND INTERNAL SUMMARY', turns: [] });
  assert.equal(calls.length, 6);
  assert.ok(calls.every(({ context }) => JSON.stringify(context.book) === JSON.stringify(opened.context)));
  assert.deepEqual(JSON.parse(sql(`SELECT history_summary FROM book_bot_sessions WHERE id='${sessionId}';`)),
    { through: 2, text: 'SECOND INTERNAL SUMMARY' });
  const restored = JSON.parse(await send(sessions));
  assert.deepEqual(restored.session.turns.map(({ question }) => question), [first.question, 'What have we discussed?', 'Continue']);
  assert.doesNotMatch(JSON.stringify(restored), /INTERNAL SUMMARY|addedPages|outlineKeys/);
  const output = process.env.PDFIT_TEST_OUTPUT;
  assert.ok(output);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.PDFIT_TEST_CHANNEL ?? 'chrome', headless: true });
  try {
    holdBrowserStages = true;
    const page = await browser.newPage({ locale: 'ko-KR', viewport: { width: 1280, height: 900 } });
    await page.addInitScript(() => localStorage.setItem('pdfit.language', 'ko'));
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(origin + '/viewer/Scan/Parallel.pdf?engine=legacy&page=1');
    await page.getByRole('button', { name: '스캔 상태', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Bot', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Bot' });
    await dialog.getByRole('button', { name: '새 채팅' }).click();
    await dialog.getByRole('textbox', { name: '질문' }).fill('Summarize chapter four');
    await dialog.getByRole('button', { name: '질문 보내기' }).click();
    await dialog.getByRole('status').getByText('질문에 필요한 페이지를 찾는 중…').waitFor();
    await page.screenshot({ path: path.join(output, 'analyzing.png') });
    browserPlan.resolve();
    await browserFirstDelta.promise;
    await dialog.getByRole('log').getByText('First fragment.', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'first-delta.png') });
    browserFinalDelta.resolve();
    await dialog.getByRole('log').getByText('First fragment. Second fragment.', { exact: true }).waitFor();
    await dialog.getByRole('textbox', { name: '질문' }).fill('');
    await page.reload();
    await page.getByRole('button', { name: 'Bot', exact: true }).click();
    await dialog.getByRole('log').getByText('First fragment. Second fragment.', { exact: true }).waitFor();
    assert.equal(calls.length, 8);
    assert.deepEqual(pageErrors, []);
  } finally {
    browserPlan.resolve();
    browserFinalDelta.resolve();
    await browser.close();
  }
  console.log(JSON.stringify({ apiCalls: 6, browserCalls: 2, wantedPages, stalePageExcluded: 12, rollovers: 2, restoredTurns: 3,
    phases: events.filter(({ type }) => type === 'progress').map(({ phase }) => phase), browserErrors: 0 }, null, 2));
} finally {
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
  if (serverId) await send('/api/settings/ai-servers/' + serverId, 'DELETE');
}
