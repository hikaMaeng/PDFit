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
