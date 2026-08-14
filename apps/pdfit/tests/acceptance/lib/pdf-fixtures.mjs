export async function createPageNumberPdf(browser, pageCount, label) {
  const context = await browser.newContext({ viewport: { width: 800, height: 1100 } });
  const page = await context.newPage();
  const pages = Array.from({ length: pageCount }, (_, index) => `
    <section class="page">
      <div class="number">${escapeHtml(label)} Page ${index + 1} of ${pageCount}</div>
    </section>
  `).join('');

  await page.setContent(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          @page { size: A4; margin: 0; }
          html, body { margin: 0; padding: 0; }
          .page {
            page-break-after: always;
            width: 100vw;
            height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            font: 48px/1.1 Arial, sans-serif;
            color: #111;
          }
          .page:last-child { page-break-after: auto; }
          .number { padding: 32px; border: 2px solid #111; }
        </style>
      </head>
      <body>${pages}</body>
    </html>
  `);

  const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  await context.close();
  return pdf;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'"'"'/g, '&#39;');
}
