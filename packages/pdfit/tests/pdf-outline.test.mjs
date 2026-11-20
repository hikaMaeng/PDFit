import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readPdfOutline } from '../dist/front/viewer/pdfOutline.js';

import { buildOutlinePdf } from './fixtures/outlinePdf.mjs';

async function withDocument(bytes, run) {
  const task = getDocument({ data: bytes, useSystemFonts: false, isEvalSupported: false });
  const doc = await task.promise;
  try { return await run(doc); } finally { await task.destroy(); }
}

describe('PDF table of contents', () => {
  it('lists every outline entry in document order with its depth and 1-based page', async () => {
    const result = await withDocument(buildOutlinePdf({ outline: true }), (doc) => readPdfOutline(doc));
    assert.equal(result.status, 'ok');
    // Expected rows are copied from the fixture description above, not from the resolver.
    assert.deepEqual(result.entries.map(({ title, depth, page }) => ({ title, depth, page })), [
      { title: 'Chapter 1', depth: 0, page: 1 },
      { title: 'Section 1.1', depth: 1, page: 2 },
      { title: 'Chapter 2', depth: 0, page: 3 },
      { title: '부록 A', depth: 0, page: 2 },
      { title: 'Website', depth: 0, page: null },
      { title: 'Missing', depth: 0, page: null },
    ]);
    assert.equal(new Set(result.entries.map((entry) => entry.key)).size, result.entries.length);
  });

  it('reports a PDF without an outline as a lookup failure', async () => {
    const result = await withDocument(buildOutlinePdf({ outline: false }), (doc) => readPdfOutline(doc));
    assert.deepEqual(result, { status: 'failed', reason: 'empty' });
  });

  it('reports an outline that throws while being read as a lookup failure', async () => {
    const source = { numPages: 1, getOutline: async () => { throw new Error('broken xref'); }, getDestination: async () => null, getPageIndex: async () => 0 };
    assert.deepEqual(await readPdfOutline(source), { status: 'failed', reason: 'error' });
  });

  it('keeps an entry whose page lookup throws, without a page', async () => {
    const source = {
      numPages: 2,
      getOutline: async () => [{ title: '  Intro\n chapter ', dest: [{ num: 9, gen: 0 }], items: [] }],
      getDestination: async () => null,
      getPageIndex: async () => { throw new Error('Invalid pageIndex request.'); },
    };
    assert.deepEqual(await readPdfOutline(source), { status: 'ok', entries: [{ key: '0', title: 'Intro chapter', depth: 0, page: null }] });
  });
});

function scanSource(pages, labels = null) {
  return {
    numPages: pages.length,
    getOutline: async () => ['1', '2'].map((title, i) => ({ title, dest: [i], items: [] })),
    getPageLabels: async () => labels,
    getPageIndex: async () => 0,
    getPage: async (page) => ({
      getViewport: () => ({ width: 600, height: 800, convertToViewportPoint: (x, y) => [x, y] }),
      getTextContent: async () => ({ items: (pages[page - 1] ?? []).map(([str, y]) => ({ str, transform: [1, 0, 0, 1, 100, y] })) }),
    }),
  };
}

describe('YES24 fallback', () => {
  it('keeps a usable embedded outline without contacting the bookstore', async () => {
    let lookedUp = false;
    const result = await withDocument(buildOutlinePdf({ outline: true }), (doc) => readPdfOutline(doc, async () => {
      lookedUp = true;
      return null;
    }));
    assert.equal(lookedUp, false);
    assert.equal(result.entries[0].title, 'Chapter 1');
  });

  it('matches unnumbered listings to body headings and ignores the printed contents page', async () => {
    const titles = ['1.1. 제목과 첫 단계', '1.2. 문서 구조 파악하기', '1.3. 원본으로 이동하기', '1.4. 마지막 기능 해보기'];
    const source = scanSource([
      [['ISBN I 978-0-306-40615-7', 300]],
      [['Part 1: 시작', 40], ['1장: 목차 만들기', 60], ...titles.map((t, i) => [`• ${t}`, 130 + 50 * i])],
      [[titles[0], 65]], [[titles[1], 65]], [[titles[2], 65]], [[titles[3], 65]], [], [],
    ]);
    const result = await readPdfOutline(source, async (isbn) => {
      assert.equal(isbn, '9780306406157');
      return { title: '실습 교재', contents: ['실습 교재', 'Part 1: 시작', '1장: 목차 만들기', ...titles].join('\n') };
    });
    assert.equal(result.source, 'yes24');
    assert.deepEqual(result.entries.map(({ page, depth }) => [page, depth]), [[3, 0], [3, 1], [3, 2], [4, 2], [5, 2], [6, 2]]);
  });

  it('learns a printed-page offset and leaves an absent destination unlinked', async () => {
    const source = scanSource([
      [], [], [], [['2 CHAPTER 1 Intro', 760]], [['3', 760]], [['4', 760]], [['5', 760]], [],
    ]);
    const result = await readPdfOutline(source, async () => ({
      title: 'Example Book', contents: 'Chapter 1 Read the text 1\n1.1 First steps 2\n1.2 Navigate to the next page 3\nIndex 27',
    }));
    assert.deepEqual(result.entries.map(({ page }) => page), [3, 4, 5, null]);
  });

  it('keeps bare chapter numbers and resolves repeated printed pages using body evidence', async () => {
    const title = 'An outline workshop';
    const sections = ['1.1 Print relationships', '1.2 Chapter arrangement', '1.3 Reading structure'];
    const source = scanSource([
      [['1', 760]], [['2', 760]], [['3', 760]],
      [[sections[0], 65], ['1', 760]], [[sections[1], 65], ['2', 760]], [[sections[2], 65], ['3', 760]],
    ], ['1', '2', '3', '4', '5', '6']);
    const result = await readPdfOutline(source, async () => ({
      title, contents: ['Part 1', 'Chapter 1', ...sections.map((row, i) => `${row} ${i + 1}`)].join('\n'),
    }));
    assert.deepEqual(result.entries.map(({ title, page, depth }) => [title, page, depth]), [
      ['Part 1', 4, 0], ['Chapter 1', 4, 1], ...sections.map((row, i) => [row, i + 4, 2]),
    ]);
  });

  it('does not return scan-volume labels when YES24 has no matching contents', async () => {
    assert.deepEqual(await readPdfOutline(scanSource([[], []]), async () => null), { status: 'failed', reason: 'empty' });
  });
});
