import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { Agent, fetch as undiciFetch } from 'undici';
import { answerBookQuestion } from '../../../packages/pdfit/dist/server/book-bot/answer.js';
import { recognizeImageText } from '../../../packages/pdfit/dist/server/ocr/visionOcr.js';
import { createTagSuggestionProviderFromEnvironment } from '../../../packages/pdfit/dist/server/services/tagSuggestion.js';
import { fetchAiModel } from '../dist/server/services/aiModelFetch.js';
import { translateDisplayTexts } from '../dist/server/services/displayTranslation.js';

const completion = (content) => Response.json({ choices: [{ message: { content } }] });

test('each Free AI feature uses the 20-minute deadline', async (t) => {
  const defaultTimeout = AbortSignal.timeout;
  const deadlines = [];
  t.mock.method(AbortSignal, 'timeout', (ms) => {
    deadlines.push(ms);
    return defaultTimeout(ms);
  });
  const server = { baseUrl: 'http://127.0.0.1/v1', model: 'fixture' };
  const readText = await recognizeImageText(server, { bytes: Buffer.from('image'), type: 'image/jpeg' }, async () => completion('OCR text'));
  assert.equal(readText, 'OCR text');

  const turn = await answerBookQuestion({
    model: server, source: { title: 'Fixture', outline: null, pages: [], clips: [], comments: [] },
    store: {}, question: 'Question', turns: [], request: async () => completion('TITLE: Topic\nAnswer'),
  });
  assert.deepEqual(turn, { answer: 'Answer', title: 'Topic' });

  const translator = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content: '["Translated"]' } }] }));
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
      requestAi: async () => completion('["프로그래밍"]'), resolveAiServer: async () => server,
    });
    assert.deepEqual(await suggest({ title: 'Fixture', availableTags: [], currentTags: [] }), ['프로그래밍']);
  }
  assert.deepEqual(deadlines.filter((ms) => ms > 10_000), Array(5).fill(1_200_000));
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
