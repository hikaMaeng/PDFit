import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.PDFIT_TEST_ORIGIN ?? 'http://127.0.0.1:15203';
const evidence = process.env.PDFIT_EVIDENCE_DIR;
const browser = await chromium.launch({ headless: true });
const results = [];
const errors = [];

async function openHome({ width, height, language, mode }) {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addInitScript(({ language, mode }) => {
    localStorage.setItem('pdfit.language', language);
    localStorage.setItem('pdfit.color-mode', mode);
  }, { language, mode });
  await context.route('**/api/settings/translations', (route) =>
    route.fulfill({ json: { translations: route.request().postDataJSON().texts } }));
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  assert.equal((await page.goto(origin, { waitUntil: 'domcontentloaded' }))?.status(), 200);
  const main = page.getByRole('main');
  await main.getByRole('heading', { level: 1 }).waitFor();
  return { context, page, main };
}

async function checkLayout(main, expectedDirection) {
  const layout = await main.evaluate((element) => ({
    direction: getComputedStyle(element).direction,
    width: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  assert.equal(layout.direction, expectedDirection);
  assert.ok(layout.scrollWidth <= layout.width + 1, JSON.stringify(layout));
  return layout;
}

async function goToFeature(page, main, linkName, targetPath, verifyDestination) {
  const link = main.getByRole('link', { name: linkName, exact: true });
  await link.click();
  await page.waitForURL(new URL(targetPath, origin).href);
  await verifyDestination();
  assert.equal(await link.count(), 0);
  await page.getByTestId('lnb-home-link').click();
  await page.waitForURL(new URL('/', origin).href);
  await main.getByRole('heading', { level: 1 }).waitFor();
}

async function screenshot(page, name, fullMain = false) {
  if (!evidence) return;
  const style = fullMain ? await page.addStyleTag({
    content: 'main, div:has(> main) { height: auto !important; overflow: visible !important; }',
  }) : null;
  await page.screenshot({ path: path.join(evidence, `${name}.png`), fullPage: fullMain, animations: 'disabled' });
  await style?.evaluate((element) => element.remove());
}

try {
  if (evidence) await mkdir(evidence, { recursive: true });
  const desktop = await openHome({ width: 1440, height: 1120, language: 'ko', mode: 'dark' });
  const { page, main } = desktop;
  await main.getByRole('heading', { level: 1, name: /수천 개의 PDF를.*AI로 정리하는 서재/ }).waitFor();
  const library = main.getByRole('region', { name: '대규모 PDF 서재 관리' });
  const ai = main.getByRole('region', { name: 'AI로 분류하고 읽기' });
  const reading = main.getByRole('region', { name: '읽고, 필요한 부분을 남기기' });
  await library.getByRole('heading', { name: '제목 검색과 태그 인덱스' }).waitFor();
  await ai.getByRole('heading', { name: '도서 자동 태그' }).waitFor();
  await ai.getByRole('heading', { name: '페이지·클립 텍스트 추출(OCR)' }).waitFor();
  await ai.getByRole('heading', { name: '서재 표시 이름 번역' }).waitFor();
  await reading.getByRole('heading', { name: '문서별 클립과 메모' }).waitFor();
  assert.equal((await library.boundingBox()).y, (await ai.boundingBox()).y);
  results.push({ locale: 'ko', mode: 'dark', layout: await checkLayout(main, 'ltr') });

  const response = await page.request.get(new URL('/api/folders', origin).href);
  assert.ok(response.ok());
  const folders = await response.json();
  const rootFolder = folders.find((folder) => folder.isRoot) ?? folders[0];
  assert.ok(rootFolder, 'Library must have a folder for the navigation check');
  const rootPath = `/folder/${encodeURIComponent(rootFolder.name)}`;
  const folderLink = main.getByRole('link', { name: '라이브러리 열기', exact: true });
  await page.waitForFunction((href) => Array.from(document.querySelectorAll('main a')).some((link) => link.getAttribute('href') === href), rootPath);
  assert.equal(await folderLink.getAttribute('href'), rootPath);
  await screenshot(page, 'desktop-dark');
  await goToFeature(page, main, '라이브러리 열기', rootPath, () => main.getByText(rootFolder.name, { exact: true }).first().waitFor());
  await goToFeature(page, main, '태그 인덱스 열기', '/tag-index', () => main.getByRole('heading', { level: 1, name: '인덱스' }).waitFor());
  await goToFeature(page, main, '미분류', '/untagged', () => main.getByTestId('untagged-title').waitFor());
  await goToFeature(page, main, '즐겨찾기', '/favorites', () => main.getByTestId('favorites-title').waitFor());
  await goToFeature(page, main, '클립 보기', '/bookmarks', () => main.getByRole('heading', { name: '마이클립' }).waitFor());
  await goToFeature(page, main, 'AI 서버 설정', '/settings', () => main.getByRole('heading', { name: '설정' }).waitFor());
  results.push({ routes: [rootPath, '/tag-index', '/untagged', '/favorites', '/bookmarks', '/settings'] });
  await desktop.context.close();

  const mobile = await openHome({ width: 375, height: 850, language: 'ko', mode: 'light' });
  const mobileLibrary = mobile.main.getByRole('region', { name: '대규모 PDF 서재 관리' });
  const mobileAi = mobile.main.getByRole('region', { name: 'AI로 분류하고 읽기' });
  const libraryBox = await mobileLibrary.boundingBox();
  assert.ok((await mobileAi.boundingBox()).y >= libraryBox.y + libraryBox.height);
  assert.equal(await mobile.page.locator('body').evaluate((body) => getComputedStyle(body).backgroundColor), 'rgb(248, 248, 248)');
  results.push({ locale: 'ko', mode: 'light', layout: await checkLayout(mobile.main, 'ltr') });
  await mobile.main.getByRole('link', { name: '라이브러리 열기', exact: true }).click({ trial: true });
  await screenshot(mobile.page, 'mobile-light', true);
  await mobile.context.close();

  const rtl = await openHome({ width: 1280, height: 1120, language: 'ar', mode: 'dark' });
  await rtl.main.getByRole('heading', { level: 2, name: 'التصنيف والقراءة بالذكاء الاصطناعي' }).waitFor();
  const rtlMain = await rtl.main.boundingBox();
  const rtlSidebarLink = await rtl.page.getByTestId('lnb-home-link').boundingBox();
  assert.ok(rtlSidebarLink.x >= rtlMain.x + rtlMain.width, 'RTL sidebar must stay to the right of the main region');
  await rtl.main.getByRole('link', { name: 'إعداد خوادم الذكاء الاصطناعي', exact: true }).click({ trial: true });
  results.push({ locale: 'ar', mode: 'dark', layout: await checkLayout(rtl.main, 'rtl'), sidebarOverlapsMain: false });
  await screenshot(rtl.page, 'desktop-arabic');
  await rtl.context.close();

  const english = await openHome({ width: 1024, height: 800, language: 'en', mode: 'light' });
  await english.main.getByRole('heading', { level: 1, name: /Thousands of PDFs.*Organized with AI/ }).waitFor();
  results.push({ locale: 'en', mode: 'light', layout: await checkLayout(english.main, 'ltr') });
  await english.context.close();
  assert.deepEqual(errors, []);
} finally {
  const report = { origin, chromium: browser.version(), results, pageErrors: errors };
  if (evidence) await writeFile(path.join(evidence, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
