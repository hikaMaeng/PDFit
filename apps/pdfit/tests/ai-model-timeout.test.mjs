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
    model: server, source: { title: 'Fixture', outline: null, pages: [], clips: [], comments: [] },
    store: {}, question: 'Question', turns: [], request: modelReply('TI', 'TLE: Topic\r', '\n', 'An', 'swer'),
    onAnswerDelta: (text) => visible.push(text),
  });
  assert.deepEqual(turn, { answer: 'Answer', title: 'Topic' });
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
  assert.deepEqual(deadlines.filter((ms) => ms > 10_000), Array(5).fill(1_200_000));
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

test('a chapter summary sends the verified chapter directly even when the book exceeds the Bot budget', async () => {
  const outline = [
    { key: '0', title: '03장', depth: 0, page: 90 },
    { key: '1', title: '▣ 04장: 컨텍스트 엔진 조립', depth: 0, page: 128 },
    { key: '1.0', title: '4.1 설명', depth: 1, page: null },
    { key: '2', title: '▣ 05장: 컨텍스트 엔진 강화', depth: 0, page: 162 },
  ];
  const pages = [
    ...Array.from({ length: 100 }, (_, index) => ({ page: index + 1, text: 'Unrelated page. '.repeat(200) })),
    { page: 128, text: 'First requested page.' },
    { page: 161, text: 'Last requested page.' },
    { page: 162, text: 'Next chapter.' },
  ];
  const calls = [];
  const phases = [];
  const visible = [];
  const store = { clipDescription: async () => assert.fail('an out-of-range clip was sent to the model') };
  const model = { baseUrl: 'http://scope.test/v1', model: 'fixture', contextTokens: 150_000 };
  const result = await answerBookQuestion({
    model, vision: model, source: { title: 'Fixture', outline, pages, clips: [{ pageIndex: 7 }], comments: [] },
    question: '4장의 내용을 요약해줘', turns: [], store,
    request: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return streamReply('TITLE: Chapter four\n', 'First line.', ' Second line.');
    },
    onProgress: ({ phase }) => phases.push(phase), onAnswerDelta: (text) => visible.push(text),
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(phases, ['generating']);
  assert.deepEqual(visible, ['First line.', ' Second line.']);
  assert.equal(result.answer, 'First line. Second line.');
  const { coverage, evidence } = JSON.parse(calls[0].messages[1].content);
  assert.deepEqual(coverage.chapter, { number: 4, firstPdfPage: 128, lastPdfPage: 161 });
  assert.equal(coverage.ocrPages, 2);
  assert.match(evidence, /4\.1 설명/);
  assert.match(evidence, /First requested page\./);
  assert.match(evidence, /Last requested page\./);
  assert.doesNotMatch(evidence, /Unrelated page|Next chapter/);
});

test('the Bot keeps book evidence when a question or outline cannot identify one bounded chapter', async () => {
  const model = { baseUrl: 'http://scope.test/v1', model: 'fixture', contextTokens: 150_000 };
  const outline = [
    { key: '0', title: 'Chapter 4', depth: 0, page: 128 },
    { key: '1', title: 'Chapter 5', depth: 0, page: 162 },
  ];
  for (const [question, entries] of [
    ['4장과 5장을 비교해줘', outline],
    ['Summarize Chapter 4', outline.slice(0, 1)],
    ['Summarize Chapter 4', [...outline, { key: '2', title: 'Chapter 4', depth: 0, page: 170 }]],
  ]) {
    await answerBookQuestion({
      model, source: { title: 'Fixture', outline: entries, pages: [{ page: 1, text: 'Outside chapter' }], clips: [], comments: [] },
      store: {}, question, turns: [], request: async (_url, init) => {
        const { coverage, evidence } = JSON.parse(JSON.parse(init.body).messages[1].content);
        assert.equal(coverage.chapter, undefined);
        assert.match(evidence, /Outside chapter/);
        return streamReply('TITLE: Fixture\nAnswer');
      },
    });
  }
});

test('Qwen counts tokens for a one-call answer even when the serialized prompt exceeds the old byte limit', async () => {
  const pages = Array.from({ length: 100 }, (_, index) => ({ page: index + 1, text: '문서 내용을 읽고 정리합니다. '.repeat(100) }));
  const model = { baseUrl: 'http://scope.test/v1', model: 'qwen36-35b', contextTokens: 150_000 };
  const calls = [];
  const phases = [];
  await answerBookQuestion({
    model, source: { title: 'Fixture', outline: null, pages, clips: [], comments: [] },
    store: {}, question: '책 전체를 요약해줘', turns: [], request: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return streamReply('TITLE: Book\nAnswer');
    },
    onProgress: ({ phase }) => phases.push(phase),
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(phases, ['generating']);
  assert.ok(Buffer.byteLength(JSON.stringify(calls[0].messages)) > 245_784);
  const count = await bookBotPromptTokenCounter(model.model);
  assert.ok(count(calls[0].messages) < model.contextTokens - calls[0].max_tokens);
  const { coverage, evidence } = JSON.parse(calls[0].messages[1].content);
  assert.equal(coverage.ocrPages, 100);
  assert.match(evidence, /PDF p\. 100\n/);
});

test('Qwen starts evidence reduction only for an oversized prompt and keeps each call within the window', async () => {
  const pages = Array.from({ length: 20 }, (_, index) => ({ page: index + 1, text: '문서 내용을 읽고 정리합니다. '.repeat(100) }));
  const model = { baseUrl: 'http://scope.test/v1', model: 'toolspace-35b-a3b', contextTokens: 16_384 };
  const phases = [];
  const calls = [];
  await answerBookQuestion({
    model, source: { title: 'Fixture', outline: null, pages, clips: [], comments: [] },
    store: {}, question: '책 전체를 요약해줘', turns: [], request: async (_url, init) => {
      const request = JSON.parse(init.body);
      calls.push(request);
      return streamReply(request.max_tokens === 2048 ? 'Short evidence note' : 'TITLE: Summary\nAnswer');
    },
    onProgress: ({ phase, completed, total }) => phases.push({ phase, completed, total }),
  });
  assert.notEqual(phases.find(({ phase }) => phase === 'evidence'), undefined);
  assert.equal(calls.at(-1).max_tokens, 4096);
  const count = await bookBotPromptTokenCounter(model.model);
  assert.ok(calls.every((call) => count(call.messages) + call.max_tokens <= model.contextTokens));
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
    model: { ...upstream, model: 'chat' }, source: { title: 'Fixture', outline: null, pages: [], clips: [], comments: [] },
    store: {}, question: 'Question', turns: [], request: request('chat', 'TITLE: Topic\nAnswer'),
    onProgress: ({ phase }) => {
      phases.chat.push(phase);
      if (phase === 'queued') chatQueued.resolve();
    },
  });
  await chatQueued.promise;
  const suggest = createOpenAiCompatibleTagSuggestionProvider({ ...upstream, model: 'tag', timeoutMs: 15 }, request('tags', '["프로그래밍"]'));
  const tags = suggest({ title: 'Fixture', availableTags: [], currentTags: [], onModelProgress: (phase) => phases.tags.push(phase) });

  try {
    await delay(45);
    assert.deepEqual(order, ['scan A', 'scan B']);
    assert.deepEqual(deadlines, [1_200_000, 1_200_000]);
    assert.deepEqual(phases, { chat: ['queued'], tags: ['queued'] });
    left.resolve('page A');
    assert.deepEqual(await chat, { title: 'Topic', answer: 'Answer' });
    assert.deepEqual(await tags, ['프로그래밍']);
    assert.equal(await next, 'text');
    assert.deepEqual(order, ['scan A', 'scan B', 'chat', 'tags', 'next scan']);
    assert.deepEqual(phases, { chat: ['queued', 'generating'], tags: ['queued', 'running'] });
    assert.deepEqual(deadlines, [1_200_000, 1_200_000, 1_200_000, 15, 1_200_000]);
  } finally {
    left.resolve('page A');
    right.resolve('page B');
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
