import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { Agent, fetch as undiciFetch } from 'undici';
import { answerBookQuestion } from '../../../packages/pdfit/dist/server/book-bot/answer.js';
import { recognizeImageText } from '../../../packages/pdfit/dist/server/ocr/visionOcr.js';
import { createTagSuggestionProviderFromEnvironment } from '../../../packages/pdfit/dist/server/services/tagSuggestion.js';
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
