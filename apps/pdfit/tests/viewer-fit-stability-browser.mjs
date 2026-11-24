import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const output = resolve(process.env.PDFIT_TEST_OUTPUT ?? 'test/20261123/viewer-fit-stability');
const browser = await chromium.launch({
  ignoreDefaultArgs: ['--hide-scrollbars'],
  args: ['--disable-features=OverlayScrollbar,FluentOverlayScrollbar'],
});
const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
const results = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

function makePdf(height) {
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 1000 ${height}]/Resources<<>>>>`,
  ];
  let document = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = document.length;
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  return Buffer.from(`${document}xref\n0 4\n0000000000 65535 f \n${offsets.join('')}trailer\n<</Size 4/Root 1 0 R>>\nstartxref\n${document.length}\n%%EOF\n`);
}

let pdfBytes;
await page.route(`${origin}/api/**`, (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path.includes('/files/') || path.includes('/by-id/')) {
    return route.fulfill({ contentType: 'application/pdf', body: pdfBytes });
  }
  const json = path.startsWith('/api/viewer-state/') ? { page: 1, scale: 1, fitMode: 'none', viewMode: 'scroll' }
    : path.startsWith('/api/progress/') ? { page: 1 }
    : /\/api\/(bookmarks|annotations)/.test(path) ? [] : {};
  return route.fulfill({ json });
});

const scrollArea = page.getByTestId('pdf-scroll-area');

async function recordAction(action) {
  await scrollArea.evaluate((viewport) => {
    window.fitFrames = new Promise((done) => {
      const frames = [];
      function sample(time) {
        const canvas = viewport.querySelector('canvas');
        const { width, height } = canvas.getBoundingClientRect();
        const size = [width, height, viewport.clientWidth, viewport.clientHeight, viewport.scrollWidth, viewport.scrollHeight];
        if (String(size) !== String(frames.at(-1))) frames.push(size);
        if (time - start < 1000) requestAnimationFrame(sample);
        else done(frames);
      }
      const start = performance.now();
      sample(start);
    });
  });
  await action();
  return page.evaluate(() => window.fitFrames);
}

function recordResult(name, frames, axis) {
  const final = frames.at(-1);
  const padding = axis === 0 ? 24 : 48;
  const sizes = frames.map((frame) => frame[axis]);
  const firstChange = sizes.findIndex((size) => size !== sizes[0]);
  const fitSizes = firstChange === -1 ? [] : [...new Set(sizes.slice(firstChange))];
  results.push({ name, frameCount: frames.length, frames: frames.slice(0, 15), fits: Math.abs(final[axis] - (final[axis + 2] - padding)) <= 1, fitSizes });
}

try {
  await mkdir(output, { recursive: true });
  for (const { name, label, height, axis } of [
    { name: 'width', label: '가로 너비 맞춤', height: 629, axis: 0 },
    { name: 'height', label: '세로 높이 맞춤', height: 635, axis: 1 },
  ]) {
    pdfBytes = makePdf(height);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${origin}/viewer/zoom/${name}.pdf?driveFileId=${name}`);
    await scrollArea.locator('canvas[data-render-state="done"]').waitFor();
    const button = page.getByRole('button', { name: label, exact: true });
    recordResult(name, await recordAction(() => button.click()), axis);
    await page.screenshot({ path: resolve(output, `fit-${name}.png`) });
    recordResult(`${name} after resize`, await recordAction(() => page.setViewportSize({ width: 1360, height: 920 })), axis);
    if (name === 'width') {
      const bookmarks = page.getByRole('button', { name: '클립', exact: true });
      recordResult('width with bookmarks', await recordAction(() => bookmarks.click()), axis);
    }
  }
  for (const result of results) {
    assert.equal(result.fits, true, `${result.name} must match the scroll area`);
    assert.equal(result.fitSizes.length, 1, `${result.name} must render one fitted size`);
  }
  assert.deepEqual(errors, []);
} finally {
  const evidence = { origin, chromium: browser.version(), results, errors };
  console.log(JSON.stringify(evidence));
  await writeFile(resolve(output, 'result.json'), JSON.stringify(evidence, null, 2));
  await browser.close();
}
