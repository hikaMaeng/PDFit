import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';

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

sql(`
  INSERT INTO books (folder, filename, size, modified_at)
    SELECT 'Foreign', filename, size, modified_at FROM books WHERE (folder, filename) = ('Scan', 'Parallel.pdf')
    ON CONFLICT DO NOTHING;
  INSERT INTO book_page_ocr_search (folder, filename, page_index, source_size, source_modified_at, body)
    SELECT folder, filename, 0, size, modified_at, 'FOREIGN stronger vector'
    FROM books WHERE (folder, filename) IN (('Foreign', 'Parallel.pdf'), ('Scan', 'Other.pdf'))
    ON CONFLICT (folder, filename, page_index) DO UPDATE SET body = EXCLUDED.body;
  INSERT INTO book_comments (id, folder, filename, body, reference_pages)
    VALUES ('${randomUUID()}', 'Scan', 'Parallel.pdf', 'Reader vector note', ARRAY[30]);
`);

const calls = [];
const queryInputs = [];
let holdBrowserStages = false;
const browserPlan = Promise.withResolvers();
const browserFirstDelta = Promise.withResolvers();
const browserFinalDelta = Promise.withResolvers();
const upstream = createServer(async (req, res) => {
  const data = [];
  for await (const chunk of req) data.push(chunk);
  const { messages, input } = JSON.parse(Buffer.concat(data));
  if (req.url === '/v1/embeddings') {
    const vectors = input.map((text, index) => {
      if (text.startsWith('query: ')) queryInputs.push(text);
      const embedding = text.includes('FOREIGN') || text.startsWith('query: ') ? [0, 1, 0, 0]
        : text.includes('marker 30') ? [0.1, 1, 0, 0]
        : text.includes('Reader vector note') ? [0.2, 1, 0, 0] : [1, 0, 0, 0];
      return { index, embedding };
    });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: vectors }));
    return;
  }
  const content = messages[1].content;
  const context = JSON.parse(content.startsWith('Book reference data (JSON)\n') ? content.split('\n', 2)[1] : content);
  const emit = (content) => 'data: ' + JSON.stringify({ choices: [{ delta: { content }, index: 0 }] }) + '\n\n';
  const done = 'data: {"choices":[{"index":0,"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
  res.setHeader('Content-Type', 'text/event-stream');
  if (messages[0].content.startsWith('Translate each JSON array item')) {
    res.end(emit(JSON.stringify(context)) + done);
    return;
  }
  calls.push({ context, messages });
  if (!context.evidence) {
    if (holdBrowserStages) await browserPlan.promise;
    const query = context.question === 'What have we discussed?' ? null : 'Relevant semantic marker';
    res.write(emit(JSON.stringify({ query })));
  } else if (content.endsWith('\nLatest reader question\nSimulate tool markup')) {
    for (const fragment of ['<tool_', 'call>', '\n<function=read_book_context>', '\n</function>\n</tool_call>']) {
      res.write(emit(fragment));
    }
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
  const { id } = JSON.parse(await send('/api/settings/ai-servers', 'POST', {
    name: 'Book Bot test', url: 'http://host.docker.internal:' + upstream.address().port + '/v1',
    models: { llm: 'qwen36-35b' }, ocrConcurrency: 2, botContextTokens: 150_000,
    embeddingCandidates: [{ name: 'fixture/book-vectors', dimensions: 4, indexDimensions: 2,
      embeddingConcurrency: 12, maxInputTokens: 512, matryoshka: true, revision: '',
      queryPrefix: 'query: ', documentPrefix: 'doc: ' }],
  }, 201));
  serverId = id;
  const servers = JSON.parse(await send('/api/settings/ai-servers'));
  const server = servers.find((candidate) => candidate.id === serverId);
  await send('/api/settings/ai-models/defaults', 'PATCH', {
    role: 'embedding', choice: { serverId, modelId: server.embeddingCandidates[0].id },
  });
  const deadline = Date.now() + 50_000;
  let indexed = 0;
  while (Date.now() < deadline) {
    indexed = Number(sql('SELECT count(DISTINCT source) FROM embedding_chunks'));
    if (indexed >= 42) break;
    await delay(400);
  }
  assert.ok(indexed >= 42, `Expected the 39 current book pages, a note and two foreign pages, indexed ${indexed}`);
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
  assert.equal(calls[0].messages.length, 2);
  assert.deepEqual(calls[1].context.book, opened.context);
  assert.equal(calls[1].context.question, undefined);
  assert.deepEqual(calls[1].messages.map(({ role }) => role), ['system', 'user']);
  assert.ok(calls[1].messages[1].content.endsWith('\n\nLatest reader question\n' + first.question));
  assert.doesNotMatch(JSON.stringify(calls[1].messages), /tool_calls|read_book_context/);
  const { matches } = calls[1].context.evidence;
  assert.equal(matches.length, 12);
  assert.deepEqual(matches[0], { scope: 'page-ocr', page: 30, text: 'Synthetic OCR marker 30' });
  assert.deepEqual(matches[1], { scope: 'book-comment', page: 30, text: 'Reader vector note' });
  assert.ok(matches.every(({ page, text }) => page !== 12 && !text.includes('FOREIGN')));
  assert.deepEqual(queryInputs, ['query: Relevant semantic marker']);
  assert.deepEqual(events.filter(({ type }) => type === 'progress').map(({ phase }) => phase),
    ['preparing', 'analyzing', 'loadingPages', 'generating', 'saving']);
  assert.deepEqual(events.filter(({ type }) => type === 'delta').map(({ text }) => text), ['First fragment. ', 'Second fragment.']);
  assert.equal(events.at(-1).revision, 1);
  assert.deepEqual(Object.keys(events.at(-1).turn), ['id', 'question', 'answer']);
  assert.equal((await postTurn(first)).at(-1).revision, 1);
  assert.equal(calls.length, 2);
  const firstSaved = JSON.parse(sql(`SELECT turns->0 FROM book_bot_sessions WHERE id='${sessionId}';`));
  const wantedPages = matches.filter(({ scope }) => scope === 'page-ocr').map(({ page }) => page);
  assert.deepEqual(firstSaved.addedPages.map(({ page }) => page), wantedPages);
  assert.deepEqual(firstSaved.outlineKeys, []);

  // Resume an existing session whose earlier turn has already been compacted.
  sql(`UPDATE book_bot_sessions SET history_summary =
    '{"through":1,"text":"FIRST INTERNAL SUMMARY"}'::jsonb WHERE id='${sessionId}';`);
  assert.equal((await postTurn({ turnId: randomUUID(), revision: 1, question: 'What have we discussed?' })).at(-1).revision, 2);
  assert.deepEqual(calls[2].context.history, { summary: 'FIRST INTERNAL SUMMARY', turns: [] });
  assert.deepEqual(calls[3].context.evidence, { retrievalStatus: 'not_requested', omittedMatches: 0, matches: [] });
  assert.equal(queryInputs.length, 1);

  assert.equal((await postTurn({ turnId: randomUUID(), revision: 2, question: 'Continue explaining the design.' })).at(-1).revision, 3);
  assert.deepEqual(calls[4].context.history.turns.map(({ question }) => question), ['What have we discussed?']);
  assert.deepEqual(calls[5].context.evidence.matches.slice(0, 2), matches.slice(0, 2));
  assert.equal(queryInputs.length, 2);
  assert.equal(calls.length, 6);
  assert.ok(calls.every(({ context }) => JSON.stringify(context.book) === JSON.stringify(opened.context)));
  const restored = JSON.parse(await send(sessions));
  assert.deepEqual(restored.session.turns.map(({ question }) => question),
    [first.question, 'What have we discussed?', 'Continue explaining the design.']);
  assert.doesNotMatch(JSON.stringify(restored), /INTERNAL SUMMARY|addedPages|outlineKeys/);

  const legacySessionId = randomUUID();
  const legacySession = '/api/book-bot/sessions?' + bookQuery + '&id=' + legacySessionId;
  const legacyTurn = { id: randomUUID(), question: 'Earlier unanswered question',
    answer: '<tool_call>\n<function=read_book_context>\n</function>\n</tool_call>' };
  await send(legacySession, 'POST', undefined, 201);
  sql(`UPDATE book_bot_sessions SET turns = '${JSON.stringify([legacyTurn])}'::jsonb WHERE id='${legacySessionId}';`);
  assert.deepEqual(JSON.parse(await send(legacySession)).session.turns, [{ ...legacyTurn, answer: '' }]);
  await send('/api/book-bot/turns?' + bookQuery, 'POST', { sessionId: legacySessionId,
    revision: 0, turnId: legacyTurn.id, question: legacyTurn.question }, 502);
  assert.deepEqual(JSON.parse(sql(`SELECT turns->0 FROM book_bot_sessions WHERE id='${legacySessionId}';`)), legacyTurn);

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
    await dialog.getByRole('log').getByText(legacyTurn.question, { exact: true }).waitFor();
    await dialog.getByRole('log').getByRole('alert').getByText('답변을 받지 못했습니다. 질문을 다시 보내 재시도하세요.').waitFor();
    assert.doesNotMatch(await dialog.getByRole('log').innerText(), /tool_call|read_book_context/);
    await page.screenshot({ path: path.join(output, 'invalid-saved-reply.png') });
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
    assert.equal(queryInputs.length, 3);
    assert.deepEqual(pageErrors, []);
  } finally {
    browserPlan.resolve();
    browserFinalDelta.resolve();
    await browser.close();
  }
  const badEvents = await postTurn({ turnId: randomUUID(), revision: 3, question: 'Simulate tool markup' });
  assert.deepEqual(badEvents.filter(({ type }) => type !== 'progress'), [{ type: 'error', status: 502 }]);
  assert.equal(JSON.parse(await send(sessions)).session.turns.length, 3);
  assert.equal(calls.length, 10);
  console.log(JSON.stringify({ apiCalls: 8, browserCalls: 2, wantedPages, firstMatch: matches[0].page, foreignHits: 0, stalePageExcluded: 12,
    vectorQueries: queryInputs.length, restoredTurns: 3,
    phases: events.filter(({ type }) => type === 'progress').map(({ phase }) => phase), browserErrors: 0,
    invalidReply: { leakedDeltas: 0, status: 502, saved: false, historicMarkupHidden: true } }, null, 2));
} finally {
  try {
    if (serverId) {
      await send('/api/settings/ai-models/defaults', 'PATCH', { role: 'embedding', choice: null });
      await send('/api/settings/ai-servers/' + serverId, 'DELETE');
    }
  } finally {
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
  }
}
