import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Agent, fetch as undiciFetch } from 'undici';
import { answerBookQuestion } from '../../../packages/pdfit/dist/server/book-bot/answer.js';
import { bookBotPromptTokenCounter } from '../../../packages/pdfit/dist/server/book-bot/promptTokens.js';
import { recognizeImageText } from '../../../packages/pdfit/dist/server/ocr/visionOcr.js';
import { createOpenAiCompatibleTagSuggestionProvider, createTagSuggestionProviderFromEnvironment } from '../../../packages/pdfit/dist/server/services/tagSuggestion.js';
import { streamAiCompletion } from '../../../packages/pdfit/dist/server/services/aiModelRequest.js';
import { fetchAiModel } from '../dist/server/services/aiModelFetch.js';
import { translateDisplayTexts } from '../dist/server/services/displayTranslation.js';

const completion = (content) => Response.json({ choices: [{ message: { content } }] });
const delta = (content) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\r\n\r\n`;
const stop = `data: ${JSON.stringify({ choices: [{ index: 0, finish_reason: 'stop' }] })}\r\n\r\ndata: [DONE]\r\n\r\n`;

function streamReply(...pieces) {
  return new Response(pieces.map(delta).join('') + stop, { headers: { 'content-type': 'text/event-stream' } });
}

const modelReply = (...pieces) => async (_url, init) => {
  assert.equal(JSON.parse(init.body).stream, true);
  return streamReply(...pieces);
};

test('each Free AI feature uses the 20-minute deadline', async (t) => {
  const defaultTimeout = AbortSignal.timeout;
  const deadlines = [];
  t.mock.method(AbortSignal, 'timeout', (ms) => {
    deadlines.push(ms);
    return defaultTimeout(ms);
  });
  const server = { baseUrl: 'http://127.0.0.1/v1', model: 'fixture' };
  const readText = await recognizeImageText(server, { bytes: Buffer.from('image'), type: 'image/jpeg' }, modelReply('OCR ', 'text'));
  assert.equal(readText, 'OCR text');

  const visible = [];
  const turn = await answerBookQuestion({
    model: server, book: botBook, source: { title: 'Fixture', outline: null },
    store: {}, question: 'Question', turns: [], historySummary: null,
    request: (url, init) => (JSON.parse(init.body).max_tokens === 2048
      ? modelReply('{"outlineKeys":[]}') : modelReply('TI', 'TLE: Topic\r', '\n', 'An', 'swer'))(url, init),
    onAnswerDelta: (text) => visible.push(text),
  });
  assert.equal(turn.answer, 'Answer');
  assert.equal(turn.title, 'Topic');
  assert.deepEqual(visible, ['An', 'swer']);

  const translator = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    if (JSON.parse(Buffer.concat(chunks)).stream !== true) { response.writeHead(400).end(); return; }
    response.setHeader('content-type', 'text/event-stream');
    response.write(delta('["Trans'));
    response.end(delta('lated"]') + stop);
  });
  translator.listen(0, '127.0.0.1');
  await once(translator, 'listening');
  try {
    const url = `http://127.0.0.1:${translator.address().port}/v1`;
    assert.deepEqual(await translateDisplayTexts({ url, models: { llm: server.model } }, ['Example'], 'en'), ['Translated']);
  } finally {
    translator.closeAllConnections();
    await new Promise((resolve) => translator.close(resolve));
  }

  const environment = { SERVICE_AI_BASE_URL: server.baseUrl, SERVICE_AI_MODEL: server.model, SERVICE_AI_API_KEY: 'fixture-key' };
  for (const config of [environment, {}]) {
    const suggest = createTagSuggestionProviderFromEnvironment(config, async () => new Response(null, { status: 404 }), {
      requestAi: modelReply('["프로', '그래밍"]'), resolveAiServer: async () => server,
    });
    assert.deepEqual(await suggest({ title: 'Fixture', availableTags: [], currentTags: [] }), ['프로그래밍']);
  }
  const modelDeadlines = deadlines.filter((ms) => ms > 10_000);
  assert.equal(modelDeadlines.length, 6);
  assert.ok(modelDeadlines.every((ms) => ms > 1_199_000 && ms <= 1_200_000));
});

test('stream decoder handles split UTF-8 and rejects incomplete or filtered completions', async () => {
  const signal = AbortSignal.timeout(5000);
  const observed = [];
  const requestFor = (raw) => async () => new Response(new ReadableStream({
    start(controller) {
      for (const byte of Buffer.from(raw)) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
  const result = await streamAiCompletion('http://fixture', {}, {
    signal, request: requestFor(': heartbeat\r\n\r\n' + delta('한글') + delta(' 😀') + stop), onDelta: (text) => observed.push(text),
  });
  assert.equal(result, '한글 😀');
  assert.deepEqual(observed, ['한글', ' 😀']);
  await assert.rejects(streamAiCompletion('http://fixture', {}, {
    signal, request: requestFor(delta('Partial answer')),
  }), /ended before completion/);
  await assert.rejects(streamAiCompletion('http://fixture', {}, {
    signal, request: requestFor(delta('Partial answer') + 'data: {"choices":[{"finish_reason":"length"}]}\n\ndata: [DONE]\n\n'),
  }), /did not finish normally/);
  assert.equal(await streamAiCompletion('http://fixture', {}, { signal, request: async () => completion('JSON fallback') }), 'JSON fallback');
});

const botBook = { folder: 'Test', filename: 'Fixture.pdf' };
const botOutline = [
  { key: '0', title: '03장', depth: 0, page: 90 },
  { key: '1', title: '▣ 04장: 컨텍스트 엔진 조립', depth: 0, page: 128 },
  { key: '1.0', title: '4.1 설명', depth: 1, page: null },
  { key: '2', title: '▣ 05장: 컨텍스트 엔진 강화', depth: 0, page: 162 },
];

test('Bot provides chosen OCR as a tool result and streams only the reply to the user', async () => {
  const calls = [];
  const phases = [];
  const visible = [];
  const question = '4장의 내용을 요약해줘';
  const result = await answerBookQuestion({
    model: { baseUrl: 'http://scope.test/v1', model: 'qwen36-35b', contextTokens: 150_000 },
    book: botBook, source: { title: 'Fixture', outline: botOutline }, question,
    turns: [], historySummary: null,
    store: { pages: async (book, ranges) => {
      assert.deepEqual(book, botBook);
      assert.equal(calls.length, 1);
      assert.deepEqual(visible, []);
      assert.deepEqual(ranges, [{ first: 128, last: 161 }]);
      return [{ page: 128, text: 'Saved OCR' }, { page: 161, text: 'Last page OCR' }];
    } },
    request: async (_url, init) => {
      const { messages } = JSON.parse(init.body);
      const reference = JSON.parse(messages.find(({ role }) => role === 'tool')?.content ?? messages[1].content);
      calls.push(reference);
      if (calls.length === 1) {
        assert.equal(reference.question, question);
        assert.equal(messages.length, 2);
        return streamReply('{"outlineKeys":["unknown","1.0",', '"1","1"]}');
      }
      assert.equal(reference.question, undefined);
      assert.deepEqual(messages[1], { role: 'user', content: question });
      assert.deepEqual(messages.map(({ role }) => role), ['system', 'user', 'assistant', 'tool', 'user']);
      assert.equal(messages[2].tool_calls[0].id, messages[3].tool_call_id);
      assert.equal(messages[2].tool_calls[0].function.name, 'read_book_context');
      assert.deepEqual(messages.at(-1), { role: 'user', content: question });
      assert.match(messages[0].content, /Put the direct answer in the opening sentence/);
      return streamReply('TITLE: Chapter four\n', 'First line.', ' Second line.');
    },
    onProgress: ({ phase }) => phases.push(phase), onAnswerDelta: (text) => visible.push(text),
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(phases, ['analyzing', 'loadingPages', 'generating']);
  assert.deepEqual(visible, ['First line.', ' Second line.']);
  assert.equal(result.answer, 'First line. Second line.');
  assert.deepEqual(result.outlineKeys, ['1']);
  assert.deepEqual(result.addedPages.map(({ page }) => page), [128, 161]);
  assert.equal(calls[0].evidence, undefined);
  assert.deepEqual(calls[0].book, calls[1].book);
  assert.deepEqual(calls[1].book.outline, botOutline);
  assert.deepEqual(calls[1].evidence.pages.map(({ page }) => page), [128, 161]);
});

test('an outline-only question skips source reads when there are no retained pages', async () => {
  for (const outline of [botOutline, [], null]) {
    let calls = 0;
    const result = await answerBookQuestion({
      model: { baseUrl: 'http://scope.test/v1', model: 'fixture' },
      book: botBook, source: { title: 'Fixture', outline }, store: {}, turns: [], historySummary: null,
      question: 'What is in the table of contents?',
      request: async (_url, init) => {
        const { messages } = JSON.parse(init.body);
        const { evidence } = JSON.parse(messages.find(({ role }) => role === 'tool')?.content ?? messages[1].content);
        if (++calls === 1) return streamReply('{"outlineKeys":[]}');
        assert.deepEqual(evidence.pages, []);
        return streamReply('Overview without a title line');
      },
    });
    assert.equal(calls, 2);
    assert.equal(result.title, 'What is in the table of contents?');
  }
});

test('a follow-up sees previous page references and adds only new page references to the transcript', async () => {
  let calls = 0;
  const question = 'Compare that chapter with the next one.';
  const turns = [{ id: 'saved', question: 'Summarize chapter four', answer: 'Earlier answer', outlineKeys: ['1'],
    addedPages: [{ page: 128, tokens: 20 }, { page: 129, tokens: 20 }] }];
  const result = await answerBookQuestion({
    model: { baseUrl: 'http://scope.test/v1', model: 'fixture' },
    book: botBook, source: { title: 'Fixture', outline: botOutline }, turns, historySummary: null,
    question,
    store: { pages: async (_book, ranges) => {
      assert.equal(calls, 1);
      assert.deepEqual(ranges, [{ first: 162, last: null }, { first: 128, last: 129 }]);
      return [{ page: 128, text: 'Earlier OCR' }, { page: 162, text: 'New OCR' }];
    } },
    request: async (_url, init) => {
      const { messages } = JSON.parse(init.body);
      const prompt = JSON.parse(messages.find(({ role }) => role === 'tool')?.content ?? messages[1].content);
      assert.deepEqual(prompt.history.turns[0].addedPages, [128, 129]);
      assert.equal(prompt.history.turns[0].answer, 'Earlier answer');
      if (++calls === 1) {
        assert.equal(prompt.evidence, undefined);
        return streamReply('{"outlineKeys":["2"]}');
      }
      assert.deepEqual(prompt.evidence.pages.map(({ page }) => page), [162, 128]);
      assert.deepEqual(messages.at(-1), { role: 'user', content: question });
      return streamReply('Compared');
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(result.addedPages.map(({ page }) => page), [162]);
});

test('repeated rollover summarizes the previous summary and tail while keeping the full outline in both stages', async () => {
  const model = { baseUrl: 'http://scope.test/v1', model: 'qwen36-35b', contextTokens: 16_384 };
  const turns = [];
  let historySummary = null;
  for (let index = 0; index < 3; index += 1) {
    turns.push({ id: 'saved-' + index, question: 'Past question ' + index, answer: 'Past answer ' + index,
      addedPages: [{ page: 128 + index, tokens: 13_108 }] });
    let calls = 0;
    const result = await answerBookQuestion({
      model, book: botBook, source: { title: 'Fixture', outline: botOutline }, store: {}, turns, historySummary,
      question: 'What have we discussed?',
      request: async (_url, init) => {
        const { messages } = JSON.parse(init.body);
        const { book, history, evidence } = JSON.parse(messages.find(({ role }) => role === 'tool')?.content ?? messages[1].content);
        assert.deepEqual(book.outline, botOutline);
        if (++calls === 1) {
          assert.match(messages[0].content, /rolling summary/);
          assert.equal(history.summary, historySummary?.text ?? null);
          assert.deepEqual(history.turns.map(({ answer }) => answer), ['Past answer ' + index]);
          assert.equal(evidence, undefined);
          return streamReply(JSON.stringify({ outlineKeys: [], historySummary: 'Summary ' + index }));
        }
        assert.deepEqual(history, { summary: 'Summary ' + index, turns: [] });
        return streamReply('Answer using the summary');
      },
    });
    assert.equal(calls, 2);
    assert.deepEqual(result.historySummary, { through: index + 1, text: 'Summary ' + index });
    historySummary = result.historySummary;
  }
});

test('oversized selected OCR fits the Qwen answer window without extra model calls', async () => {
  const pages = Array.from({ length: 20 }, (_, index) => ({ page: index + 90, text: '문서 내용을 읽고 정리합니다. '.repeat(100) }));
  const model = { baseUrl: 'http://scope.test/v1', model: 'toolspace-35b-a3b', contextTokens: 16_384 };
  const calls = [];
  await answerBookQuestion({
    model, book: botBook, source: { title: 'Fixture', outline: botOutline },
    store: { pages: async () => pages }, turns: [], historySummary: null, question: '책 전체를 요약해줘',
    request: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return streamReply(calls.length === 1 ? '{"outlineKeys":["0","1","2"]}' : 'TITLE: Summary\nAnswer');
    },
  });
  assert.equal(calls.length, 2);
  const count = await bookBotPromptTokenCounter(model.model);
  assert.ok(calls.every((call) => count(call.messages) + call.max_tokens <= model.contextTokens));
  const { evidence } = JSON.parse(calls[1].messages.find(({ role }) => role === 'tool').content);
  assert.ok(evidence.omittedOcrPages > 0);
  assert.ok(evidence.pages.length > 0);
  assert.equal(evidence.pages.length + evidence.omittedOcrPages, pages.length);
});

test('chat and tags overtake waiting scan pages without interrupting occupied model slots', async (t) => {
  const defaultTimeout = AbortSignal.timeout;
  const deadlines = [];
  t.mock.method(AbortSignal, 'timeout', (ms) => {
    deadlines.push(ms);
    return defaultTimeout(ms);
  });
  const upstream = { baseUrl: 'http://queue.test/v1', ocrConcurrency: 2 };
  const image = { bytes: Buffer.from('image'), type: 'image/jpeg' };
  const left = Promise.withResolvers();
  const right = Promise.withResolvers();
  const chatQueued = Promise.withResolvers();
  const answerQueued = Promise.withResolvers();
  const tagResponse = Promise.withResolvers();
  const order = [];
  const phases = { chat: [], tags: [] };
  const request = (label, reply) => async (_url, init) => {
    order.push(label);
    assert.equal(init.signal.aborted, false);
    return completion(await reply);
  };
  const first = recognizeImageText({ ...upstream, model: 'vision' }, image, request('scan A', left.promise));
  const second = recognizeImageText({ ...upstream, model: 'vision' }, image, request('scan B', right.promise));
  const next = recognizeImageText({ ...upstream, model: 'vision' }, image, request('next scan', 'text'));
  const cancel = new AbortController();
  const cancelled = recognizeImageText({ ...upstream, model: 'vision' }, image, request('cancelled scan', 'text'), undefined, undefined, cancel.signal);
  cancel.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  const chat = answerBookQuestion({
    model: { ...upstream, model: 'chat' }, book: botBook, source: { title: 'Fixture', outline: null },
    store: {}, question: 'Question', turns: [], historySummary: null,
    request: (url, init) => JSON.parse(init.body).max_tokens === 2048
      ? request('chat plan', '{"outlineKeys":[]}')(url, init)
      : request('chat answer', 'TITLE: Topic\nAnswer')(url, init),
    onProgress: ({ phase }) => {
      phases.chat.push(phase);
      if (phase === 'queued') {
        if (phases.chat.includes('analyzing')) answerQueued.resolve();
        else chatQueued.resolve();
      }
    },
  });
  await chatQueued.promise;
  const suggest = createOpenAiCompatibleTagSuggestionProvider({ ...upstream, model: 'tag', timeoutMs: 15 }, request('tags', tagResponse.promise));
  const tags = suggest({ title: 'Fixture', availableTags: [], currentTags: [], onModelProgress: (phase) => phases.tags.push(phase) });

  try {
    await delay(45);
    assert.deepEqual(order, ['scan A', 'scan B']);
    assert.deepEqual(deadlines, [1_200_000, 1_200_000]);
    assert.deepEqual(phases, { chat: ['queued'], tags: ['queued'] });
    left.resolve('page A');
    await answerQueued.promise;
    tagResponse.resolve('["프로그래밍"]');
    assert.equal((await chat).answer, 'Answer');
    assert.deepEqual(await tags, ['프로그래밍']);
    assert.equal(await next, 'text');
    assert.deepEqual(order, ['scan A', 'scan B', 'chat plan', 'tags', 'chat answer', 'next scan']);
    assert.deepEqual(phases, { chat: ['queued', 'analyzing', 'queued', 'generating'], tags: ['queued', 'running'] });
    assert.deepEqual(deadlines.slice(0, 4), [1_200_000, 1_200_000, 1_200_000, 15]);
    assert.ok(deadlines[4] > 1_199_000 && deadlines[4] <= 1_200_000);
    assert.equal(deadlines[5], 1_200_000);
  } finally {
    left.resolve('page A');
    right.resolve('page B');
    tagResponse.resolve('["프로그래밍"]');
    await Promise.allSettled([first, second, next, chat, tags]);
  }
});

test('the AI transport waits for delayed headers and body and respects cancellation', async () => {
  const short = new Agent({ headersTimeout: 25, bodyTimeout: 25 });
  const server = createServer((_request, response) => {
    setTimeout(() => {
      if (response.destroyed) return;
      response.write('slow ');
      setTimeout(() => { if (!response.destroyed) response.end('reply'); }, 1_200);
    }, 1_200);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    await assert.rejects(undiciFetch(url, { dispatcher: short }), (error) => error.cause?.code === 'UND_ERR_HEADERS_TIMEOUT');
    const response = await fetchAiModel(url);
    assert.equal(await response.text(), 'slow reply');
    await assert.rejects(fetchAiModel(url, { signal: AbortSignal.timeout(40) }), { name: 'TimeoutError' });
  } finally {
    await short.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
