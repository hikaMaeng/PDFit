import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { createPageNumberPdf } from './acceptance/lib/pdf-fixtures.mjs';

const base = process.env.PDFIT_TEST_BASE_URL;
assert(base && new URL(base).hostname === '127.0.0.1' && ['15922', '15923'].includes(new URL(base).port), 'Use an isolated Free test container');
const output = path.resolve(process.env.PDFIT_TEST_OUTPUT ?? 'test/20261127/embedding-search');
const liveProvider = process.env.PDFIT_TEST_LIVE_EMBEDDINGS;
const model = liveProvider ? 'embeddinggemma2:mp' : 'fixture/mrl-embedding';
const dimensions = liveProvider ? 768 : 4;
const indexDimensions = liveProvider ? 768 : 2;
const batchWidth = liveProvider ? 12 : 3;
const target = 'tailuniquetext';
const changed = 'newuniquetailedit';
const requests = [];
const errors = [];
let concurrent = 0;
let maxConcurrent = 0;
let releaseFirstBatch;
let heldFirstBatch = false;
const firstBatchGate = new Promise((resolve) => { releaseFirstBatch = resolve; });

function vector(text) {
  if (text.includes(changed)) return [0, 1, 1, 0];
  if (text.includes(target)) return [0, 1, 0, 1];
  if (text.includes('clipcommentfixture')) return [1, 1, 0, 0];
  if (text.includes('plaincommentfixture')) return [1, 1, 0, 1];
  return [1, 0, 0, 0.125];
}

const mock = createServer(async (req, res) => {
  if (req.url === '/v1/chat/completions') {
    req.resume();
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Embedding acceptance recognized clip text' } }] })}\n\ndata: [DONE]\n\n`);
    return;
  }
  concurrent += 1;
  maxConcurrent = Math.max(maxConcurrent, concurrent);
  try {
    const buffers = [];
    for await (const chunk of req) buffers.push(chunk);
    const body = JSON.parse(Buffer.concat(buffers).toString('utf8'));
    assert.equal(req.url, '/v1/embeddings');
    assert.equal(req.method, 'POST');
    assert.equal(body.model, model);
    assert.ok(Array.isArray(body.input));
    assert.ok(body.input.every((value) => typeof value === 'string' && Buffer.byteLength(value) + 8 <= 512));
    requests.push({ width: body.input.length, concurrent, probe: body.input.every((value) => value.startsWith('PDFit ')),
      document: body.input.every((value) => value.startsWith('doc: ')), tail: body.input.some((value) => value.includes(target)),
      changed: body.input.some((value) => value.includes(changed)) });
    if (liveProvider) {
      const response = await fetch(liveProvider, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(25_000) });
      assert.ok(response.ok, `Live embeddings server returned ${response.status}`);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(await response.text());
      return;
    }
    if (!heldFirstBatch && requests.at(-1).document && body.input.length === batchWidth) {
      heldFirstBatch = true;
      await firstBatchGate;
    }
    await pause(18);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: body.input.map((text, index) => ({ embedding: vector(text), index })).reverse() }));
  } catch (error) {
    errors.push(String(error));
    res.writeHead(400).end();
  } finally { concurrent -= 1; }
});

async function json(route, method = 'GET', data) {
  const res = await fetch(`${base}${route}`, { method,
    ...(data === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }) });
  const body = await res.text();
  assert.ok(res.ok, `${method} ${route} returned ${res.status}: ${body.slice(0, 350)}`);
  return body ? JSON.parse(body) : undefined;
}

async function waitFor(check, description, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  do {
    const value = await check();
    if (value) return value;
    await pause(100);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${description}`);
}

function semantic(q, scope) { return json('/api/search/semantic', 'POST', { q, scope }); }

await mkdir(output, { recursive: true });
mock.listen(0, '0.0.0.0');
await once(mock, 'listening');
const browser = await chromium.launch({ headless: true, executablePath: process.env.PDFIT_TEST_CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 1360, height: 930 } });
page.on('pageerror', (error) => errors.push(error.message));
await page.addInitScript(() => localStorage.setItem('pdfit.language', 'ko'));
const screenshot = (name) => page.screenshot({ path: path.join(output, `${name}.png`), animations: 'disabled' });

try {
  const folder = `Embeddings-${randomUUID().slice(0, 8)}`;
  const filename = 'Long OCR Fixture.pdf';
  const source = { folder, filename, pageIndex: 0 };
  const original = `${'Body text with bounded chunks and overlap. '.repeat(1600)}\n끝부분 🧭 ${target} calibration code of the cobalt compass at the Observatory of Mists.`;
  const query = liveProvider ? `${target} calibration code of the cobalt compass at the Observatory of Mists` : target;
  assert.ok(original.indexOf(target) > 64_000);
  await json('/health');
  const mockUrl = `http://host.docker.internal:${mock.address().port}/v1`;
  await json('/api/settings/ai-servers', 'POST', { name: 'Vision fixture', url: mockUrl, models: { vision: 'fixture-vision' } });
  await json('/api/folders', 'POST', { name: folder });
  const form = new FormData();
  form.append('files', new Blob([await createPageNumberPdf(browser, 2, 'Embedding acceptance')], { type: 'application/pdf' }), filename);
  const upload = await fetch(`${base}/api/folders/${folder}/files`, { method: 'POST', body: form });
  assert.ok(upload.ok, await upload.text());
  const first = await json('/api/ocr/page', 'POST', source);
  assert.equal(first.source, 'text-layer');
  const written = await json('/api/ocr/page', 'PUT', { ...source, revision: first.revision, text: original });
  assert.equal(written.text, original);
  assert.equal((await json(`/api/search/content/page-ocr?q=${target}`)).hits.length, 0);

  const commentId = randomUUID();
  const comment = `/api/book-comments?${new URLSearchParams({ folder, filename, id: commentId })}`;
  await json(comment, 'POST', { id: commentId, body: 'plaincommentfixture ordinary source', referencePages: [1] });
  const bookmarkRoute = `/api/bookmarks/${folder}/${encodeURIComponent(filename)}`;
  const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: 'white' } }).png().toBuffer();
  const clip = await json(bookmarkRoute, 'POST', { pageIndex: 0, rect: { x: 0, y: 0, width: 1, height: 1 },
    borderColor: '#111111', comment: 'clipcommentfixture', imageMimeType: 'image/png', imageBase64: png.toString('base64') });
  await waitFor(async () => (await json(bookmarkRoute)).find((entry) => entry.id === clip.id && entry.ocr?.status === 'done'), 'clip OCR');

  await page.goto(`${base}/settings`);
  await page.getByRole('button', { name: '서버 추가' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: '서버 이름' }).fill('Embedding Fixture');
  await dialog.getByRole('textbox', { name: '서버 URL' }).fill(mockUrl);
  await dialog.getByRole('button', { name: 'LLM 추가', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'LLM 모델' }).fill('fixture-llm');
  await dialog.getByRole('button', { name: '임베딩 모델 추가', exact: true }).click();
  await dialog.getByRole('textbox', { name: '임베딩 모델', exact: true }).fill(model);
  await dialog.getByRole('spinbutton', { name: '기본 차원' }).fill(String(dimensions));
  await dialog.getByRole('spinbutton', { name: '인덱스 차원' }).fill(String(indexDimensions));
  await dialog.getByRole('spinbutton', { name: '임베딩 동시성 (요청당 텍스트 수)' }).fill(String(batchWidth));
  if (!liveProvider) await dialog.getByRole('checkbox', { name: 'Matryoshka (MRL) 지원' }).check();
  await dialog.getByRole('textbox', { name: '문서 프리픽스' }).fill('doc: ');
  await screenshot('01-embedding-candidate');
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const [server] = (await json('/api/settings/ai-servers')).filter(({ name }) => name === 'Embedding Fixture');
  const select = async (label, name) => {
    await page.getByRole('combobox', { name: label }).click();
    await page.getByRole('option', { name, exact: true }).click();
  };
  await select('기본 LLM', 'Embedding Fixture · fixture-llm');
  await waitFor(async () => (await json('/api/settings/ai-models/defaults')).llm?.modelId === server.llmCandidates[0].id, 'default LLM');
  await select('기본 임베딩 모델', `Embedding Fixture · ${model}`);
  await waitFor(async () => (await json('/api/settings/ai-models/defaults')).embedding?.modelId === server.embeddingCandidates[0].id, 'default embedding');
  await screenshot('02-default-models');
  await waitFor(() => requests.some(({ document, width }) => document && width === batchWidth), `array with ${batchWidth} texts`);
  if (!liveProvider) {
    // The only shared worker must be available to OCR while the provider holds this batch.
    const ocr = await Promise.race([json('/api/ocr/page', 'POST', { ...source, pageIndex: 1 }),
      pause(5000).then(() => { throw new Error('Shared OCR worker waited for an in-flight embedding'); })]);
    assert.equal(ocr.pageIndex, 1);
    assert.equal(concurrent, 1);
    releaseFirstBatch();
  }
  await Promise.all(Array.from({ length: 5 }, () => semantic(query, 'page-ocr')));
  const results = await waitFor(async () => {
    const result = await semantic(query, 'page-ocr');
    return result.hits.some((hit) => hit.snippet.includes(target)) && result;
  }, 'long OCR trailing text', liveProvider ? 150_000 : 70_000);
  assert.equal(results.hits[0].page, 1);
  assert.equal(results.hits[0].filename, filename);

  for (const [scope, search, id] of [['clip-ocr', 'Embedding acceptance', clip.id], ['clip-memo', 'clipcommentfixture', clip.id],
    ['book-comment', 'plaincommentfixture', commentId]]) {
    assert.ok((await semantic(search, scope)).hits.some((hit) => hit.id === id));
  }

  await page.goto(`${base}/search?q=${encodeURIComponent(query)}`);
  await page.getByRole('tab', { name: '의미 검색' }).click();
  const list = page.getByTestId('semantic-search-results');
  await list.getByText(target, { exact: false }).waitFor();
  assert.match(await list.getByRole('link', { name: filename }).first().getAttribute('href'), /page=1$/);
  await screenshot('03-long-ocr-tail-result');
  await page.goto(`${base}/search?q=plaincommentfixture&mode=semantic&source=book-comment`);
  await page.getByRole('button', { name: '코멘트 열기' }).click();
  await page.getByTestId('book-comments-content').getByText('plaincommentfixture ordinary source').waitFor();
  await screenshot('04-comment-deep-link');

  const phase = requests.length;
  let edit;
  if (!liveProvider) {
    await json(`/api/settings/ai-servers/${server.id}`, 'PATCH', {
      embeddingCandidates: [{ ...server.embeddingCandidates[0], embeddingConcurrency: 2 }],
    });
    await json('/api/ocr/page', 'PUT', { ...source, revision: written.revision, text: original.replace(target, changed) });
    assert.ok(!(await semantic(target, 'page-ocr')).hits.some((hit) => hit.snippet.includes(target)), 'the old revision must disappear');
    edit = await waitFor(async () => {
      const result = await semantic(changed, 'page-ocr');
      return result.hits.some((hit) => hit.snippet.includes(changed)) && result;
    }, 'automatic periodic reindex after a tail-only edit', 100_000);
  }
  const batches = requests.filter(({ document }) => document);
  const firstPhase = requests.slice(0, phase).filter(({ document }) => document);
  const secondPhase = requests.slice(phase).filter(({ document }) => document);
  assert.ok(firstPhase.length > 1 && firstPhase.every(({ width }) => width <= batchWidth) && firstPhase.some(({ width }) => width === batchWidth));
  assert.ok(firstPhase.some(({ tail }) => tail));
  if (edit) {
    assert.ok(secondPhase.length > 1 && secondPhase.every(({ width }) => width <= 2) && secondPhase.some(({ width }) => width === 2));
    assert.ok(secondPhase.some(({ changed: hasEditedTail }) => hasEditedTail));
  }
  assert.equal(maxConcurrent, 1);
  assert.deepEqual(errors, []);
  const status = (await json('/api/tasks/status')).details.embedding;
  const proof = { base, model, dimensions, indexDimensions, originalLength: original.length, tailOffset: original.indexOf(target), maxConcurrent,
    batchRequests: batches.length, initialWidths: [...new Set(firstPhase.map(({ width }) => width))].sort(),
    editedWidths: [...new Set(secondPhase.map(({ width }) => width))].sort(), initialHit: results.hits[0], editedHit: edit?.hits[0],
    status, workerProgressWhileEmbedding: heldFirstBatch, errors, requests };
  await writeFile(path.join(output, 'results.json'), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify({ ...proof, requests: undefined, output }));
} finally {
  releaseFirstBatch();
  await browser.close();
  mock.close();
  await once(mock, 'close');
}
