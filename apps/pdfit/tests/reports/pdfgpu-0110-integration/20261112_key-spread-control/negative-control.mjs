// Negative control: run against a deploy whose two viewer components are the pre-change (HEAD) code.
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:15203';
const folder = '이북';
const name = process.argv[2];
const url = (q) => `${origin}/viewer/${encodeURIComponent(folder)}/${encodeURIComponent(name)}${q}`;
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 1000 } });
const blocked = [];
await context.route('**/*', (route) => {
  const r = route.request();
  if (r.method() === 'GET' || r.method() === 'HEAD') return route.continue();
  blocked.push(`${r.method()} ${new URL(r.url()).pathname}`);
  return route.abort();
});
const page = await context.newPage();
const out = {};
try {
  await page.goto(url('?page=1'), { waitUntil: 'domcontentloaded' });
  await page.locator('[data-legacy-page-shell="true"]').first().waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: '두 페이지 보기', exact: true }).click();
  await page.waitForTimeout(800);
  const shells = () => page.locator('[data-legacy-page-shell="true"]').evaluateAll((n) => n.map((x) => Number(x.getAttribute('data-page-index')) + 1).sort((a, b) => a - b));
  await page.mouse.click(5, 500);
  const rows = [await shells()];
  for (let i = 0; i < 3; i += 1) { await page.keyboard.press('PageDown'); await page.waitForTimeout(700); rows.push(await shells()); }
  out.legacyDoublePageDownRows = rows;

  await page.goto(url('?engine=gpu&page=1'), { waitUntil: 'domcontentloaded' });
  const area = page.getByTestId('pdfgpu-scroll-area');
  await area.waitFor({ timeout: 60000 });
  await page.waitForFunction(() => /Pages:\s*\d+\s*\/\s*[1-9]/.test(document.body.innerText), null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  const pg = async () => Number((await page.locator('body').innerText()).match(/Pages:\s*(\d+)/)?.[1]);
  await area.focus();
  const before = await pg();
  await page.keyboard.press('PageDown'); await page.waitForTimeout(1200);
  out.gpuFocusedPageDown = { before, after: await pg(), focused: await page.evaluate(() => document.activeElement?.getAttribute('data-testid')) };
} catch (e) { out.error = String(e); }
await browser.close();
out.blockedWrites = blocked.length;
console.log(JSON.stringify(out, null, 2));
