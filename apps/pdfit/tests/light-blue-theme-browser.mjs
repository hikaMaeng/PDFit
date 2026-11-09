import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.PDFIT_TEST_BASE_URL ?? 'http://127.0.0.1:15201';
const outputDir = 'apps/pdfit/tests/reports/light-blue-theme/20260930_160000';
await mkdir(outputDir, { recursive: true });

const rgb = (value) => value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
const luminance = (value) => {
  const channels = rgb(value).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};
const contrast = (foreground, background) => {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => localStorage.setItem('pdfit.color-mode', 'light'));
  const signIn = await context.request.post(`${baseUrl}/api/auth/local-preview`, { headers: { Origin: baseUrl } });
  assert.equal(signIn.status(), 200);
  const page = await context.newPage();
  await page.goto(`${baseUrl}/folder/PDFit%20Library`, { waitUntil: 'domcontentloaded' });
  await page.locator('.pdfit-pdf-row').first().waitFor({ state: 'visible', timeout: 30_000 });
  const rootFolderRow = page.getByTestId('lnb-folder-row').filter({ hasText: 'PDFit Library' });
  assert.equal(await rootFolderRow.getByRole('button', { name: /폴더 삭제/ }).count(), 0, '삭제할 수 없는 루트 폴더에 삭제 버튼이 표시됨');
  const deletableFolderRow = page.getByTestId('lnb-folder-row').filter({ hasNotText: 'PDFit Library' }).first();
  if (await deletableFolderRow.count()) assert.equal(await deletableFolderRow.getByRole('button', { name: /폴더 삭제/ }).count(), 1, '삭제 가능한 폴더의 삭제 버튼이 보이지 않음');

  const colors = await page.evaluate(() => {
    const color = (selector, property = 'color') => getComputedStyle(document.querySelector(selector))[property];
    const sidebar = document.querySelector('.MuiDrawer-paper');
    const selected = [...sidebar.querySelectorAll('.Mui-selected')].find((element) => element.textContent.includes('PDFit Library'));
    const folderIcon = sidebar.querySelector('[data-testid="FolderIcon"]');
    if (!selected || !folderIcon) throw new Error('사이드바 폴더 표시를 찾지 못함');
    let rowSurface = document.querySelector('.pdfit-pdf-row');
    while (rowSurface && getComputedStyle(rowSurface).backgroundColor === 'rgba(0, 0, 0, 0)') rowSurface = rowSurface.parentElement;
    return {
      canvas: color('body', 'backgroundColor'),
      sidebar: getComputedStyle(sidebar).backgroundColor,
      sidebarText: getComputedStyle(selected).color,
      selectedBackground: getComputedStyle(selected).backgroundColor,
      sidebarIcon: getComputedStyle(folderIcon).color,
      documentLink: color('.pdfit-row-action-tags'),
      rowSurface: rowSurface ? getComputedStyle(rowSurface).backgroundColor : getComputedStyle(document.body).backgroundColor,
      metadataIcon: color('.pdfit-pdf-row [aria-label="문서 정보"]'),
    };
  });
  assert.equal(colors.canvas, 'rgb(229, 243, 255)');
  assert.equal(colors.sidebar, 'rgb(32, 78, 121)');
  assert.equal(colors.rowSurface, 'rgb(255, 255, 255)');
  assert.ok(contrast(colors.sidebarText, colors.selectedBackground) >= 4.5, `사이드바 글자 대비 부족: ${JSON.stringify(colors)}`);
  assert.ok(contrast(colors.sidebarIcon, colors.sidebar) >= 3, `사이드바 파란 아이콘 대비 부족: ${JSON.stringify(colors)}`);
  assert.ok(contrast(colors.documentLink, colors.rowSurface) >= 4.5, `본문 파란 링크 대비 부족: ${JSON.stringify(colors)}`);
  assert.ok(contrast(colors.metadataIcon, colors.rowSurface) >= 3, `문서 정보 파란 아이콘 대비 부족: ${JSON.stringify(colors)}`);
  await page.screenshot({ path: `${outputDir}/folder-light-blue.png`, fullPage: true });
  await page.goto(`${baseUrl}/tag/%EC%9E%90%EA%B8%B0%EA%B3%84%EB%B0%9C`, { waitUntil: 'domcontentloaded' });
  await page.locator('.pdfit-pdf-row').first().waitFor({ state: 'visible', timeout: 30_000 });
  assert.equal(await page.getByTestId('tag-title-row').locator('button').count(), 1, '태그 제목 색상 아이콘이 사라짐');
  assert.equal(await page.locator('body').evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(229, 243, 255)');
  assert.equal(await page.locator('.pdfit-pdf-row').first().evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(255, 255, 255)');
  await page.screenshot({ path: `${outputDir}/tag-light-blue.png`, fullPage: true });
  const tagDelete = page.locator('.pdfit-tag-row').first().getByRole('button', { name: '태그 삭제' });
  assert.equal(await tagDelete.evaluate((element) => getComputedStyle(element).opacity), '0');
  await page.locator('.pdfit-tag-row').first().hover();
  await page.waitForTimeout(200);
  assert.equal(await tagDelete.evaluate((element) => getComputedStyle(element).opacity), '0.8');
  console.log(JSON.stringify({ colors, contrast: {
    sidebarText: contrast(colors.sidebarText, colors.selectedBackground),
    sidebarIcon: contrast(colors.sidebarIcon, colors.sidebar),
    documentLink: contrast(colors.documentLink, colors.rowSurface),
    metadataIcon: contrast(colors.metadataIcon, colors.rowSurface),
  } }, null, 2));
  await context.close();

  const darkContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await darkContext.addInitScript(() => localStorage.setItem('pdfit.color-mode', 'dark'));
  const darkSignIn = await darkContext.request.post(`${baseUrl}/api/auth/local-preview`, { headers: { Origin: baseUrl } });
  assert.equal(darkSignIn.status(), 200);
  const darkPage = await darkContext.newPage();
  await darkPage.goto(`${baseUrl}/folder/PDFit%20Library`, { waitUntil: 'domcontentloaded' });
  await darkPage.locator('.pdfit-pdf-row').first().waitFor({ state: 'visible', timeout: 30_000 });
  const darkColors = await darkPage.evaluate(() => ({
    canvas: getComputedStyle(document.body).backgroundColor,
    sidebar: getComputedStyle(document.querySelector('.MuiDrawer-paper')).backgroundColor,
    folderIcon: getComputedStyle(document.querySelector('.MuiDrawer-paper [data-testid="FolderIcon"]')).color,
  }));
  assert.deepEqual(darkColors, {
    canvas: 'rgb(20, 20, 20)', sidebar: 'rgb(27, 27, 29)', folderIcon: 'rgb(59, 130, 246)',
  });
  console.log(JSON.stringify({ darkColors }, null, 2));
  await darkContext.close();

  const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await touchContext.addInitScript(() => localStorage.setItem('pdfit.color-mode', 'light'));
  const touchSignIn = await touchContext.request.post(`${baseUrl}/api/auth/local-preview`, { headers: { Origin: baseUrl } });
  assert.equal(touchSignIn.status(), 200);
  const touchPage = await touchContext.newPage();
  await touchPage.goto(`${baseUrl}/tag/%EC%9E%90%EA%B8%B0%EA%B3%84%EB%B0%9C`, { waitUntil: 'domcontentloaded' });
  await touchPage.locator('.pdfit-pdf-row').first().waitFor({ state: 'visible', timeout: 30_000 });
  const touchHover = await touchPage.evaluate(() => matchMedia('(hover: none)').matches);
  assert.equal(touchHover, true);
  await touchPage.getByRole('button', { name: '메뉴 열기' }).click();
  const touchTagDelete = touchPage.locator('.MuiDrawer-paper .pdfit-tag-row').first().getByRole('button', { name: '태그 삭제' });
  assert.equal(await touchTagDelete.evaluate((element) => getComputedStyle(element).opacity), '0.8');
  await touchContext.close();
} finally {
  await browser.close();
}
