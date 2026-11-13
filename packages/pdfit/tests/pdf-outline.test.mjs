import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readPdfOutline } from '../dist/front/viewer/pdfOutline.js';

// Builds a 3-page PDF. `outline: true` adds a document outline (/Outlines) with:
//   Chapter 1      -> explicit dest to page object 3 (page 1)
//     Section 1.1  -> explicit dest to page object 4 (page 2)
//   Chapter 2      -> named dest (chap2) resolved through the /Names /Dests tree to page 3
//   부록 A         -> UTF-16BE title, dest stored as a 0-based page index (1 = page 2)
//   Website        -> URI action, no page
//   Missing        -> named dest that the name tree does not define
// Offsets are computed so PDF.js opens it without xref recovery.
function utf16Hex(text) {
  let hex = 'FEFF';
  for (const ch of text) hex += ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
  return `<${hex}>`;
}

function buildPdf({ outline }) {
  const content = 'BT /F1 12 Tf 20 20 Td (p) Tj ET\n';
  const page = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 6 0 R /Resources << /Font << /F1 15 0 R >> >> >>';
  const objects = {
    1: outline ? '<< /Type /Catalog /Pages 2 0 R /Outlines 7 0 R /Names << /Dests 13 0 R >> >>' : '<< /Type /Catalog /Pages 2 0 R >>',
    2: '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>',
    3: page, 4: page, 5: page,
    6: `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
    15: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  };
  if (outline) {
    Object.assign(objects, {
      7: '<< /Type /Outlines /First 8 0 R /Last 14 0 R /Count 6 >>',
      8: '<< /Title (Chapter 1) /Parent 7 0 R /Next 10 0 R /First 9 0 R /Last 9 0 R /Count 1 /Dest [3 0 R /XYZ 0 200 0] >>',
      9: '<< /Title (Section 1.1) /Parent 8 0 R /Dest [4 0 R /Fit] >>',
      10: '<< /Title (Chapter 2) /Parent 7 0 R /Prev 8 0 R /Next 11 0 R /Dest (chap2) >>',
      11: `<< /Title ${utf16Hex('부록 A')} /Parent 7 0 R /Prev 10 0 R /Next 12 0 R /Dest [1 /Fit] >>`,
      12: '<< /Title (Website) /Parent 7 0 R /Prev 11 0 R /Next 14 0 R /A << /S /URI /URI (https://example.com/) >> >>',
      13: '<< /Names [(chap2) [5 0 R /Fit]] >>',
      14: '<< /Title (Missing) /Parent 7 0 R /Prev 12 0 R /Dest (nowhere) >>',
    });
  }
  const size = 16;
  let body = '%PDF-1.4\n';
  const offsets = new Array(size).fill(null);
  for (let id = 1; id < size; id += 1) {
    if (!objects[id]) continue;
    offsets[id] = Buffer.byteLength(body, 'latin1');
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let id = 1; id < size; id += 1) {
    body += offsets[id] === null ? '0000000000 65535 f \n' : `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, 'latin1'));
}

async function withDocument(bytes, run) {
  const task = getDocument({ data: bytes, useSystemFonts: false, isEvalSupported: false });
  const doc = await task.promise;
  try { return await run(doc); } finally { await task.destroy(); }
}

describe('PDF table of contents', () => {
  it('lists every outline entry in document order with its depth and 1-based page', async () => {
    const result = await withDocument(buildPdf({ outline: true }), (doc) => readPdfOutline(doc));
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
    const result = await withDocument(buildPdf({ outline: false }), (doc) => readPdfOutline(doc));
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
