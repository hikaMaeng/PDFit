import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

// 숨은 OCR 층 품질 판정과 클립 고해상도 렌더링을 배포된 Free 서버와 실제 AI 서버로 확인한다.
// 계약: packages/pdfit/docs/api.md "OCR (local runtime)" 1·2단계.
// 쓰기: 클립 하나를 `POST /api/bookmarks/:id/ocr`로 다시 읽는다(그 클립 OCR만 바뀐다). 페이지 결과는 /app/data/ocr에 캐시된다.
const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const folder = process.env.PDFIT_TEST_FOLDER ?? '이북';
const runId = process.env.PDFIT_TEST_RUN ?? '20261113_ocr-quality';
const waitMs = Number(process.env.PDFIT_TEST_OCR_WAIT_MS ?? 600_000);
const output = new URL(`./reports/ocr-quality/${runId}/`, import.meta.url);
await mkdir(output, { recursive: true });

// Expected route per page, from the calibration (hidden layer score vs 1.0) and the probe of text rendering modes.
const pages = [
  { filename: '개미수열을 푸는 10가지 방법.pdf', pageIndex: 10, expect: 'text-layer', why: 'visible (digital) text' },
  { filename: '실용주의 프로그래머(20주년 기념판).pdf', pageIndex: 40, expect: 'text-layer', why: 'hidden layer, score 0.49 < 1.0' },
  { filename: '인공지능을 위한 수학.pdf', pageIndex: 28, expect: 'vision', why: 'hidden layer, score 3.33 >= 1.0' },
];
const result = { runId, origin, pages: [], clip: null };
const listBookmarks = async () => { const body = await (await fetch(`${origin}/api/bookmarks`)).json(); return Array.isArray(body) ? body : body.bookmarks; };

try {
  const clip = (await listBookmarks())[0];
  assert.ok(clip, 'a clip exists');
  const before = clip.ocr;
  const started = Date.now();
  const retry = await fetch(`${origin}/api/bookmarks/${clip.id}/ocr`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  let after = null;
  while (Date.now() - started < waitMs) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    after = (await listBookmarks()).find((item) => item.id === clip.id)?.ocr;
    if (after && after.status !== 'pending') break;
  }
  result.clip = { id: clip.id, filename: clip.filename, page: clip.pageIndex + 1, rect: clip.rect, retryStatus: retry.status, seconds: (Date.now() - started) / 1000, before, after };

  for (const page of pages) {
    const pageStarted = Date.now();
    const response = await fetch(`${origin}/api/ocr/page`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder, filename: page.filename, pageIndex: page.pageIndex }), signal: AbortSignal.timeout(waitMs) });
    const body = await response.json();
    result.pages.push({ ...page, status: response.status, seconds: (Date.now() - pageStarted) / 1000, source: body.source, cached: body.cached, durationMs: body.durationMs, chars: body.text?.replace(/\s+/g, '').length, text: body.text });
  }
} finally {
  await writeFile(new URL('result.json', output), JSON.stringify(result, null, 2));
}

assert.equal(result.clip.retryStatus, 202);
assert.equal(result.clip.after.status, 'done');
assert.equal(result.clip.after.source, 'vision', 'the garbled hidden layer of the clip area goes to the vision model');
for (const page of result.pages) assert.equal(page.source, page.expect, `${page.filename} p${page.pageIndex + 1}: ${page.why}`);
console.log(JSON.stringify({ clip: { ...result.clip, before: result.clip.before?.text?.slice(0, 120), after: result.clip.after?.text?.slice(0, 300) }, pages: result.pages.map(({ text, ...rest }) => ({ ...rest, head: text?.slice(0, 120) })) }, null, 2));
