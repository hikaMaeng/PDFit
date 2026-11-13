// Builds a small valid single-page PDF: a filled colour band and one line of text.
// The cross-reference offsets are computed, so PDF.js opens it without recovery.
// `hiddenText` draws the line with text rendering mode 3 (invisible), like an OCR layer over a scan.
export function buildPdf({ label = 'PDFit', rgb = [0.1, 0.4, 0.8], width = 300, height = 400, hiddenText = false } = {}) {
  const content = `${rgb.join(' ')} rg\n0 ${height - 120} ${width} 120 re f\n0 0 0 rg\nBT ${hiddenText ? '3 Tr ' : ''}/F1 24 Tf 20 ${height - 200} Td (${label.replace(/[()\\]/g, '')}) Tj ET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
