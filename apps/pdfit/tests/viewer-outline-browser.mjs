import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// 배포된 Free 서버에서 뷰어 목차 보기를 검증한다. 파일·DB는 가로채지 않는다(실제 라이브러리, 실제 DB).
// 1) 목차 있는 책: 버튼 → 모달 목록이 PDF 원본 목차와 같고, 첫 조회는 PDF에서 읽어 DB에 저장(PUT 200),
//    항목 클릭 → 그 페이지로 이동, 새로고침 후 재조회는 DB 저장본(data-source=stored).
// 2) 목차 없는 책: "목차 조회 실패", DB에 저장되지 않음(PUT 없음, GET 404).
// 3) GPU 엔진(?engine=gpu): 같은 버튼과 모달.
const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const runId = process.env.PDFIT_TEST_RUN ?? '20261113_deployed';
const output = new URL(`../../../test/${runId.slice(0, 8)}/viewer-outline/${runId}/`, import.meta.url);
await mkdir(output, { recursive: true });

const WITH_OUTLINE = { folder: '이북', filename: '(만화)미적분 7일만에 끝내기.pdf' };
const WITHOUT_OUTLINE = { folder: 'AX', filename: 'Session Brief_01_1. AX시대 어떻게 일하고 살아가며 성장할 것인가_202608_vFinal.pdf' };
const enc = encodeURIComponent;
const viewerUrl = (book, query = '') => `${origin}/viewer/${enc(book.folder)}/${enc(book.filename)}${query}`;
const outlineApi = (book) => `${origin}/api/outlines/${enc(book.folder)}/${enc(book.filename)}`;
const fileUrl = (book) => `${origin}/api/folders/${enc(book.folder)}/files/${enc(book.filename)}`;

/** Expected rows, built from PDF.js `getOutline()` here, independently of the app's reader. */
async function expectedOutline(book) {
  const response = await fetch(fileUrl(book));
  assert.equal(response.status, 200, `file ${book.filename}`);
  const task = getDocument({ data: new Uint8Array(await response.arrayBuffer()), isEvalSupported: false });
  const doc = await task.promise;
  try {
    const rows = [];
    const walk = async (nodes, depth) => {
      for (const node of nodes ?? []) {
        let page = null;
        try {
          const dest = typeof node.dest === 'string' ? await doc.getDestination(node.dest) : node.dest;
          if (Array.isArray(dest) && dest[0] != null) page = (typeof dest[0] === 'object' ? await doc.getPageIndex(dest[0]) : dest[0]) + 1;
        } catch { page = null; }
        rows.push({ title: String(node.title).replace(/\s+/g, ' ').trim(), depth, page });
        await walk(node.items, depth + 1);
      }
    };
    await walk(await doc.getOutline(), 0);
    return rows;
  } finally { await task.destroy(); }
}

const browser = await chromium.launch({ headless: true, ...(process.env.PDFIT_TEST_CHANNEL ? { channel: process.env.PDFIT_TEST_CHANNEL } : {}) });
const results = [];
const record = (name, pass, detail) => { results.push({ name, pass, ...detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`, JSON.stringify(detail)); };

async function openPage() {
  const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  const outlineRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.url().includes('/api/outlines/')) outlineRequests.push({ method: response.request().method(), status: response.status() });
  });
  return { context, page, errors, outlineRequests };
}

async function readDialog(page) {
  const dialog = page.getByRole('dialog', { name: '목차' });
  await dialog.waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('[data-testid="pdf-outline-list"], [data-testid="pdf-outline-failed"]').first().waitFor({ timeout: 60000 });
  const list = page.getByTestId('pdf-outline-list');
  if (await list.count()) {
    const rows = await page.getByTestId('pdf-outline-entry').evaluateAll((items) => items.map((item) => ({
      title: item.querySelector('.MuiListItemText-primary')?.textContent ?? '',
      depth: Number(item.getAttribute('data-depth')),
      page: item.getAttribute('data-page') ? Number(item.getAttribute('data-page')) : null,
    })));
    return { kind: 'list', source: await list.getAttribute('data-source'), rows };
  }
  const failed = page.getByTestId('pdf-outline-failed');
  return { kind: 'failed', reason: await failed.getAttribute('data-reason'), text: (await failed.textContent()) ?? '' };
}

try {
  const before = await fetch(outlineApi(WITH_OUTLINE));
  const beforeStatus = before.status;
  const expected = await expectedOutline(WITH_OUTLINE);
  await writeFile(new URL('expected-outline.json', output), JSON.stringify(expected, null, 2));

  // ── 1. 목차 있는 책, PDF.js 엔진 ───────────────────────────────
  {
    const { context, page, errors, outlineRequests } = await openPage();
    await page.goto(viewerUrl(WITH_OUTLINE), { waitUntil: 'domcontentloaded' });
    const button = page.getByRole('button', { name: '목차' });
    await assert.doesNotReject(button.waitFor({ state: 'visible', timeout: 30000 }));
    await page.waitForFunction(() => !document.querySelector('[data-testid="viewer-outline-open"]')?.hasAttribute('disabled'), null, { timeout: 60000 });
    await button.click();
    const first = await readDialog(page);
    await page.screenshot({ path: fileURLToPath(new URL('1-outline-first-open.png', output)) });
    await page.waitForTimeout(1500);
    const stored = await (await fetch(outlineApi(WITH_OUTLINE))).json().catch(() => null);
    const firstPass = first.kind === 'list' && JSON.stringify(first.rows) === JSON.stringify(expected)
      && (beforeStatus === 404 ? first.source === 'pdf' && outlineRequests.some((r) => r.method === 'PUT' && r.status === 200) : first.source === 'stored')
      && JSON.stringify(stored?.entries?.map(({ title, depth, page }) => ({ title, depth, page }))) === JSON.stringify(expected);
    record('with-outline first open lists the PDF outline and it is in the DB', firstPass, { beforeStatus, source: first.source, rows: first.kind === 'list' ? first.rows.length : 0, expectedRows: expected.length, outlineRequests: [...outlineRequests], storedRows: stored?.entries?.length ?? null });

    // 항목 클릭 → 이동 (현재 페이지와 다른 페이지를 가진 마지막 항목)
    const target = [...expected].reverse().find((row) => row.page !== null && row.page > 1) ?? expected.find((row) => row.page !== null);
    await page.getByTestId('pdf-outline-entry').filter({ hasText: target.title }).first().click();
    await page.getByRole('dialog', { name: '목차' }).waitFor({ state: 'hidden', timeout: 10000 });
    await page.waitForTimeout(800);
    const pageValue = await page.getByRole('textbox', { name: '페이지 번호' }).inputValue().catch(async () => page.locator('[data-testid="viewer-page-indicator"] input').inputValue());
    const navPass = Number(pageValue) === target.page || Number(pageValue) === target.page - 1;
    record('clicking an entry moves to its page', navPass, { target, pageInput: pageValue });
    await page.screenshot({ path: fileURLToPath(new URL('2-after-entry-click.png', output)) });

    // 새로고침 후 재조회 → DB 저장본
    outlineRequests.length = 0;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.querySelector('[data-testid="viewer-outline-open"]')?.hasAttribute('disabled'), null, { timeout: 60000 });
    await page.getByRole('button', { name: '목차' }).click();
    const second = await readDialog(page);
    await page.screenshot({ path: fileURLToPath(new URL('3-outline-after-reload.png', output)) });
    const secondPass = second.kind === 'list' && second.source === 'stored' && JSON.stringify(second.rows) === JSON.stringify(expected)
      && !outlineRequests.some((r) => r.method === 'PUT');
    record('after reload the outline comes from the DB and is not stored again', secondPass, { source: second.source, outlineRequests: [...outlineRequests] });
    record('with-outline page errors', errors.length === 0, { errors });
    await context.close();
  }

  // ── 2. 목차 없는 책 ────────────────────────────────────────────
  {
    const { context, page, errors, outlineRequests } = await openPage();
    await page.goto(viewerUrl(WITHOUT_OUTLINE), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.querySelector('[data-testid="viewer-outline-open"]')?.hasAttribute('disabled'), null, { timeout: 60000 });
    await page.getByRole('button', { name: '목차' }).click();
    const state = await readDialog(page);
    await page.screenshot({ path: fileURLToPath(new URL('4-no-outline-failed.png', output)) });
    await page.waitForTimeout(800);
    const after = await fetch(outlineApi(WITHOUT_OUTLINE));
    const pass = state.kind === 'failed' && state.reason === 'empty' && state.text.includes('목차 조회 실패')
      && !outlineRequests.some((r) => r.method === 'PUT') && after.status === 404;
    record('without-outline shows lookup failure and stores nothing', pass, { state, outlineRequests: [...outlineRequests], getAfter: after.status });
    record('without-outline page errors', errors.length === 0, { errors });
    await context.close();
  }

  // ── 3. GPU 엔진 ───────────────────────────────────────────────
  {
    const { context, page, errors } = await openPage();
    await page.goto(viewerUrl(WITH_OUTLINE, '?engine=gpu'), { waitUntil: 'domcontentloaded' });
    const button = page.getByRole('button', { name: '목차' });
    await button.waitFor({ state: 'visible', timeout: 60000 });
    await page.waitForFunction(() => !document.querySelector('[data-testid="viewer-outline-open"]')?.hasAttribute('disabled'), null, { timeout: 90000 });
    const engine = (await page.getByTestId('pdfgpu-scroll-area').count()) ? 'gpu' : 'legacy-fallback';
    await button.click();
    const state = await readDialog(page);
    await page.screenshot({ path: fileURLToPath(new URL('5-gpu-engine-outline.png', output)) });
    const pass = state.kind === 'list' && JSON.stringify(state.rows) === JSON.stringify(expected);
    record('engine=gpu lists the same outline', pass, { engine, source: state.source, rows: state.kind === 'list' ? state.rows.length : 0 });
    record('engine=gpu page errors', errors.length === 0, { errors });
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(new URL('results.json', output), JSON.stringify({ origin, runId, finishedAt: new Date().toISOString(), results }, null, 2));
}

const failed = results.filter((result) => !result.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
