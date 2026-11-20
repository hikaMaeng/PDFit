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

export function buildOutlinePdf({ outline }) {
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
