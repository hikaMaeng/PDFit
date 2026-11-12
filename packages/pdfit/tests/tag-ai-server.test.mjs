import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTagSuggestionProviderFromEnvironment,
  createYes24PublicBookLookup,
} from '../dist/server/bootstrap/index.js';

const SEARCH_URL_PREFIX = 'https://www.yes24.com/product/search?';
const DETAIL_URL = 'https://www.yes24.com/product/goods/196209093';
const AI_URL = 'http://ai.test:18180/v1/chat/completions';

const searchHtml = '<a class="gd_name" href="/product/goods/196209093">클린 코드</a><a class="gd_name" href="/product/goods/1">파이썬 클린 코드</a>';
// The detail page keeps each section's HTML entity-encoded inside a textarea.
const detailHtml = `
  <script>var x = {"genre": ["IT 모바일","컴퓨터 공학","소프트웨어 공학"]};</script>
  <div id="infoset_introduce"><textarea class="txtContentText">&lt;b&gt;개발자의 안목&lt;/b&gt;&lt;br/&gt;깨끗한 코드를 짜는 법 &amp;amp; 원칙</textarea><p>noise</p></div>
  <div id="infoset_toc"><textarea class="txtContentText">1장 클린 코드&lt;br&gt;2장 의미 있는 이름</textarea></div>
  <div id="infoset_pubReivew">ignored</div>`;

/** Routes YES24 pages and the AI server; records the AI request bodies. */
function fakeNetwork({ aiAnswer = '["프로그래밍"]', aiStatus = 200 } = {}) {
  const aiRequests = [];
  const urls = [];
  const request = async (input, init = {}) => {
    const url = String(input);
    urls.push(url);
    if (url.startsWith(SEARCH_URL_PREFIX)) return new Response(searchHtml, { status: 200 });
    if (url === DETAIL_URL) return new Response(detailHtml, { status: 200 });
    if (url === AI_URL) {
      aiRequests.push({ body: JSON.parse(init.body), headers: init.headers, signal: init.signal });
      if (aiStatus !== 200) return new Response('{}', { status: aiStatus });
      return new Response(JSON.stringify({ choices: [{ message: { content: aiAnswer } }] }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
  return { request, aiRequests, urls };
}

const aiServer = { baseUrl: 'http://ai.test:18180/v1', model: 'qwen36-35b', headers: { 'X-Test': '1' }, timeoutMs: 300_000 };

test('public YES24 lookup returns the genre path and decoded description and contents', async () => {
  const { request } = fakeNetwork();
  const book = await createYes24PublicBookLookup(request)('클린 코드');
  assert.equal(book.itemId, '196209093');
  assert.equal(book.matchedTitle, '클린 코드');
  assert.deepEqual(book.categories, ['IT 모바일', '컴퓨터 공학', '소프트웨어 공학']);
  assert.equal(book.description, '개발자의 안목 깨끗한 코드를 짜는 법 & 원칙', 'encoded markup is restored and stripped; text outside the textarea is ignored');
  assert.equal(book.tableOfContents, '1장 클린 코드 2장 의미 있는 이름');
});

test('with a Settings AI server the AI judges from the book description, contents and genre', async () => {
  const network = fakeNetwork({ aiAnswer: '["프로그래밍"]' });
  const provider = createTagSuggestionProviderFromEnvironment({}, network.request, { resolveAiServer: async () => aiServer });
  const tags = await provider({ title: '클린 코드', availableTags: [], currentTags: [] });
  assert.deepEqual(tags, ['프로그래밍'], 'the AI answer wins over the genre rule (which would give 소프트웨어)');
  assert.equal(network.aiRequests.length, 1);
  const [request] = network.aiRequests;
  assert.equal(request.body.model, 'qwen36-35b');
  assert.equal(request.headers['X-Test'], '1', 'Settings server headers are sent');
  const payload = JSON.parse(request.body.messages[1].content);
  assert.deepEqual(payload.bookstoreMetadata, {
    source: 'YES24',
    matchedTitle: '클린 코드',
    categories: ['IT 모바일', '컴퓨터 공학', '소프트웨어 공학'],
    description: '개발자의 안목 깨끗한 코드를 짜는 법 & 원칙',
    tableOfContents: '1장 클린 코드 2장 의미 있는 이름',
  });
});

test('when the AI server fails the bookstore genre still decides', async () => {
  const network = fakeNetwork({ aiStatus: 500 });
  const provider = createTagSuggestionProviderFromEnvironment({}, network.request, { resolveAiServer: async () => aiServer });
  assert.deepEqual(await provider({ title: '클린 코드', availableTags: [], currentTags: [] }), ['소프트웨어']);
});

test('an AI answer outside the taxonomy falls back to the genre rule', async () => {
  const network = fakeNetwork({ aiAnswer: '["클린코드"]' });
  const provider = createTagSuggestionProviderFromEnvironment({}, network.request, { resolveAiServer: async () => aiServer });
  assert.deepEqual(await provider({ title: '클린 코드', availableTags: [], currentTags: [] }), ['소프트웨어']);
});

test('without an AI server no AI request is made and the genre rule decides', async () => {
  const network = fakeNetwork();
  const provider = createTagSuggestionProviderFromEnvironment({}, network.request, { resolveAiServer: async () => null });
  assert.deepEqual(await provider({ title: '클린 코드', availableTags: [], currentTags: [] }), ['소프트웨어']);
  assert.equal(network.aiRequests.length, 0);
  assert.equal(network.urls.filter((url) => url === AI_URL).length, 0);
});

test('SERVICE_AI_* wins over the Settings AI server', async () => {
  const network = fakeNetwork();
  let resolved = 0;
  const provider = createTagSuggestionProviderFromEnvironment(
    { SERVICE_AI_BASE_URL: 'http://127.0.0.1:9/v1', SERVICE_AI_MODEL: 'env-model', SERVICE_AI_API_KEY: 'k' },
    network.request,
    { resolveAiServer: async () => { resolved += 1; return aiServer; } },
  );
  await provider({ title: '클린 코드', availableTags: [], currentTags: [] });
  assert.equal(resolved, 0, 'the Settings resolver is not consulted');
  assert.equal(network.aiRequests.length, 0, 'the Settings server is not called');
});

test('a failing Settings resolver behaves like no AI server', async () => {
  const network = fakeNetwork();
  const provider = createTagSuggestionProviderFromEnvironment({}, network.request, { resolveAiServer: async () => { throw new Error('db down'); } });
  assert.deepEqual(await provider({ title: '클린 코드', availableTags: [], currentTags: [] }), ['소프트웨어']);
});
