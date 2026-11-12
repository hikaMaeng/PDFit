import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { once } from 'node:events';
import {
  AUTOMATIC_TAG_MAX,
  AUTOMATIC_TAG_MIN,
  AUTOMATIC_TAG_SYSTEM_PROMPT,
  createOpenAiCompatibleTagSuggestionProvider,
  createYes24PublicBookLookup,
  selectAutomaticTags,
} from '../dist/server/bootstrap/index.js';
import { createTagsRouter } from '../dist/server/routes/tags.js';

// Contract under test (packages/pdfit/docs/usage.md "Automatic tags"): one run applies
// 4 to 6 tags, the bookstore category first, then subject tags that reuse the library's
// spelling of an existing tag.

test('a run asks for 4 to 6 tags, the category first, reusing library tags', () => {
  assert.equal(AUTOMATIC_TAG_MIN, 4);
  assert.equal(AUTOMATIC_TAG_MAX, 6);
  assert.match(AUTOMATIC_TAG_SYSTEM_PROMPT, /JSON array of 4 to 6 tag strings/);
  assert.match(AUTOMATIC_TAG_SYSTEM_PROMPT, /Tag 1 is the single deepest applicable category from bookstoreTaxonomy/);
  assert.match(AUTOMATIC_TAG_SYSTEM_PROMPT, /reuse the exact spelling of a matching name in availableTags/);
  assert.match(AUTOMATIC_TAG_SYSTEM_PROMPT, /tableOfContents/);
  assert.match(AUTOMATIC_TAG_SYSTEM_PROMPT, /untrusted data/);
});

test('selection keeps one category first, maps spelling variants to library tags and caps at 6', () => {
  const availableTags = ['LLM', 'RAG', '웹개발', 'Python'];
  assert.deepEqual(
    selectAutomaticTags(['llm', '인공지능', 'Rag', 'python', '프로그래밍', '파인튜닝', '에이전트', '평가', '추가'], { availableTags, title: 'AI 엔지니어링' }),
    ['인공지능', 'LLM', 'RAG', 'Python', '파인튜닝', '에이전트'],
    'the category leads, a second bookstore category is dropped, variants take the library spelling, six at most',
  );
  assert.deepEqual(selectAutomaticTags(['LLM', 'RAG'], { availableTags }), [], 'without a category nothing is applied');
  assert.deepEqual(
    selectAutomaticTags(['인공지능', 'AI 엔지니어링', '보고서', '기타', '인공 지능', 'LLM'], { availableTags, title: 'AI 엔지니어링' }),
    ['인공지능', 'LLM'],
    'the title, document categories, legacy categories and a spacing variant of the category are dropped',
  );
});

test('the AI answer keeps subject tags after the category', async () => {
  const provider = createOpenAiCompatibleTagSuggestionProvider(
    { baseUrl: 'https://ai.example.test/v1', model: 'm' },
    async () => new Response(JSON.stringify({ choices: [{ message: { content: '["LLM","인공지능","소프트웨어","RAG","프롬프트 엔지니어링","파인튜닝"]' } }] }), { status: 200 }),
  );
  assert.deepEqual(
    await provider({ title: 'AI 엔지니어링', availableTags: [], currentTags: [] }),
    ['인공지능', 'LLM', 'RAG', '프롬프트 엔지니어링', '파인튜닝'],
  );
  const empty = createOpenAiCompatibleTagSuggestionProvider(
    { baseUrl: 'https://ai.example.test/v1', model: 'm' },
    async () => new Response(JSON.stringify({ choices: [{ message: { content: '["LLM","RAG"]' } }] }), { status: 200 }),
  );
  assert.deepEqual(await empty({ title: 'x', availableTags: [], currentTags: [] }), [], 'no category means no usable answer, so the genre rule decides');
});

test('a YES24 table of contents keeps up to 6000 characters, a description 2000', async () => {
  const toc = Array.from({ length: 1500 }, (_, index) => `${index}장`).join(' ');
  const description = 'ㄱ'.repeat(3000);
  const detail = `<script>{"genre": ["IT 모바일"]}</script>
    <div id="infoset_introduce"><textarea class="txtContentText">${description}</textarea></div>
    <div id="infoset_toc"><textarea class="txtContentText">${toc}</textarea></div>`;
  const lookup = createYes24PublicBookLookup(async (input) => String(input).includes('/product/search')
    ? new Response('<a class="gd_name" href="/product/goods/7">AI 엔지니어링</a>', { status: 200 })
    : new Response(detail, { status: 200 }));
  const book = await lookup('AI 엔지니어링');
  assert.ok(toc.length > 6000);
  assert.equal(book.tableOfContents.length, 6000);
  assert.equal(book.description.length, 2000);
});

async function listen(context, router) {
  const app = express();
  app.use(express.json());
  app.use('/api/tags', router);
  const server = app.listen(0, '127.0.0.1');
  context.after(() => server.close());
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}/api/tags`;
}

test('single-book route applies every selected tag and replaces only an old category', async (context) => {
  const added = [];
  const removed = [];
  const store = {
    listTags: async () => ['LLM', 'RAG', 'AI'],
    listBookTags: async () => ['AI', '프로그래밍'],
    addTag: async (_folder, _filename, tag) => added.push(tag),
    removeTag: async (_folder, _filename, tag) => removed.push(tag),
  };
  const base = await listen(context, createTagsRouter(store, async () => ['인공지능', 'llm', 'rag', 'AI', '파인튜닝']));
  const response = await fetch(`${base}/book/${encodeURIComponent('이북')}/${encodeURIComponent('AI 엔지니어링.pdf')}/auto`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    title: 'AI 엔지니어링',
    suggestedTags: ['인공지능', 'LLM', 'RAG', 'AI', '파인튜닝'],
    addedTags: ['인공지능', 'LLM', 'RAG', '파인튜닝'],
    removedTags: ['프로그래밍'],
  });
  assert.deepEqual(added, ['인공지능', 'LLM', 'RAG', '파인튜닝']);
  assert.deepEqual(removed, ['프로그래밍'], 'the old bookstore category goes; the manual AI tag stays');
});

test('folder route reports assignedTags and stores every new relation', async (context) => {
  const relations = [];
  const store = {
    listTags: async () => ['LLM'],
    listFolderTags: async () => ({ 'AI 엔지니어링.pdf': ['LLM'] }),
    addTags: async (values) => relations.push(...values.map((value) => value.tag)),
    removeTag: async () => {},
  };
  const base = await listen(context, createTagsRouter(store, async () => ['인공지능', 'LLM', '에이전트', 'RAG']));
  const response = await fetch(`${base}/folder/${encodeURIComponent('이북')}/auto`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ books: [{ filename: 'AI 엔지니어링.pdf' }] }) });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.addedTags, 3);
  assert.deepEqual(payload.books.map((book) => [book.assignedTag, book.assignedTags, book.addedTags]), [
    ['인공지능', ['인공지능', 'LLM', '에이전트', 'RAG'], ['인공지능', '에이전트', 'RAG']],
  ]);
  assert.deepEqual(relations, ['인공지능', '에이전트', 'RAG']);
});

test('reasoning_effort is sent only when the server config asks for it', async () => {
  const bodies = [];
  const answer = async (_url, init) => { bodies.push(JSON.parse(init.body)); return new Response(JSON.stringify({ choices: [{ message: { content: '["인공지능","LLM"]' } }] }), { status: 200 }); };
  await createOpenAiCompatibleTagSuggestionProvider({ baseUrl: 'https://ai.example.test/v1', model: 'm', reasoningEffort: 'low' }, answer)({ title: 'x', availableTags: [], currentTags: [] });
  await createOpenAiCompatibleTagSuggestionProvider({ baseUrl: 'https://ai.example.test/v1', model: 'm' }, answer)({ title: 'x', availableTags: [], currentTags: [] });
  assert.equal(bodies[0].reasoning_effort, 'low');
  assert.equal('reasoning_effort' in bodies[1], false);
});
