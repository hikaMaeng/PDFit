import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// 폴더 페이지가 목록·표지 보기 모두 파일명 유니코드 코드 포인트 순(NFC)으로 보이는지 배포된 Free 서버에서 검증한다.
// 계약: apps/pdfit/docs/usage.md "A folder page lists its PDFs in Unicode order of the filename ...".
// 기대 순서는 화면 코드가 아니라 `GET /api/folders/:name/files`의 이름을 이 파일 안의 독립 비교 함수로 정렬해 만든다.
// 이 테스트는 아무것도 쓰지 않는다.
const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const folder = process.env.PDFIT_TEST_FOLDER ?? '이북';
const channel = process.env.PDFIT_TEST_CHANNEL ?? 'chrome';
const runId = process.env.PDFIT_TEST_RUN ?? '20261113_folder-unicode-order';
const sampleSize = Number(process.env.PDFIT_TEST_SAMPLE ?? 40);
const output = new URL(`./reports/folder-unicode-order/${runId}/`, import.meta.url);
await mkdir(output, { recursive: true });
const shot = (name) => decodeURIComponent(new URL(name, output).pathname.slice(1));

/** Independent oracle: compare arrays of code points of the NFC names. */
const codePoints = (value) => Array.from(value.normalize('NFC'), (char) => char.codePointAt(0));
function oracle(left, right) {
  const a = codePoints(left);
  const b = codePoints(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return a.length - b.length;
}

const files = await (await fetch(`${origin}/api/folders/${encodeURIComponent(folder)}/files`)).json();
const expected = files.map((file) => file.name).sort(oracle);
const result = { runId, origin, folder, fileCount: files.length, expectedHead: expected.slice(0, sampleSize), steps: [], pageErrors: [], writes: [] };

const browser = await chromium.launch({ channel, headless: true });
try {
  const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => { try { localStorage.setItem('pdfit.language', 'ko'); } catch {} });
  const page = await context.newPage();
  page.on('pageerror', (error) => result.pageErrors.push(String(error)));
  page.on('request', (request) => { if (!['GET', 'HEAD'].includes(request.method()) && !request.url().includes('/api/settings/translations')) result.writes.push(`${request.method()} ${new URL(request.url()).pathname}`); });
  await page.goto(`${origin}/folder/${encodeURIComponent(folder)}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '목록 보기' }).waitFor({ timeout: 30_000 });

  for (const [view, selector, file] of [
    ['목록 보기', '[data-testid="pdf-filename-line"] a', 'list.png'],
    ['표지 보기', '[data-testid="pdf-cover-title-row"]', 'cover.png'],
  ]) {
    await page.getByRole('button', { name: view }).click();
    await page.locator(selector).nth(Math.min(sampleSize, files.length) - 1).waitFor({ timeout: 30_000 });
    const shown = (await page.locator(selector).allTextContents()).map((text) => text.trim()).filter(Boolean);
    const head = shown.slice(0, sampleSize);
    const mismatch = head.findIndex((name, index) => name !== expected[index] && name !== expected[index].replace(/\.pdf$/i, ''));
    result.steps.push({ view, shownCount: shown.length, head, firstMismatch: mismatch });
    await page.screenshot({ path: shot(file) });
  }
  await context.close();
} finally {
  await browser.close();
  await writeFile(new URL('result.json', output), JSON.stringify(result, null, 2));
}

for (const step of result.steps) assert.equal(step.firstMismatch, -1, `${step.view}: first ${sampleSize} names follow Unicode order`);
assert.deepEqual(result.pageErrors, []);
assert.deepEqual(result.writes, []);
console.log(JSON.stringify(result.steps.map((step) => ({ view: step.view, shownCount: step.shownCount, firstMismatch: step.firstMismatch, head: step.head.slice(0, 6) })), null, 2));
