import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fetchJson } from './lib/runtime.mjs';
import { createPageNumberPdf } from './lib/pdf-fixtures.mjs';

function seed(overrides = {}) {
  return {
    folders: [],
    tags: [],
    progress: [],
    viewerStates: [],
    ...overrides,
  };
}

function row(page, text) {
  return page.locator('li').filter({ hasText: text }).first();
}

function rowButton(locator, index) {
  return locator.getByRole('button').nth(index);
}

function iconButton(page, testId) {
  return page.locator(`svg[data-testid="${testId}"]`).first().locator('xpath=ancestor::button[1]');
}

function textbox(page) {
  return page.locator('input[type="text"], input:not([type])').last();
}

async function openHome(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitText(page, 'PDFit');
}

async function openFolder(page, folder) {
  await page.goto(`/folder/${encodeURIComponent(folder)}`, { waitUntil: 'domcontentloaded' });
  await waitText(page, folder);
}

async function openTag(page, tag) {
  await page.goto(`/tag/${encodeURIComponent(tag)}`, { waitUntil: 'domcontentloaded' });
  await waitText(page, tag);
}

async function openViewer(page, folder, filename) {
  await page.goto(`/viewer/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`, {
    waitUntil: 'domcontentloaded',
  });
  await waitText(page, filename);
  await Promise.race([
    page.locator('input[type="text"]').first().waitFor({ state: 'visible' }),
    page.locator('canvas').first().waitFor({ state: 'visible' }),
  ]);
  await page.waitForFunction(() => {
    const status = document.querySelector('[aria-label="viewer status"]')?.textContent ?? '';
    return /Pages:\s*[1-9]\d*\s*\/\s*[1-9]\d*/.test(status);
  });
}

async function waitText(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible' });
}

async function acceptDialog(page) {
  page.once('dialog', (dialog) => void dialog.accept());
}

async function dragByText(page, sourceText, targetText) {
  await page.evaluate(({ sourceText: source, targetText: target }) => {
    const find = (needle) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let node = walker.currentNode;
      while (node) {
        if ((node.textContent ?? '').includes(needle)) return node;
        node = walker.nextNode();
      }
      return null;
    };

    const sourceEl = find(source);
    const targetEl = find(target);
    if (!sourceEl || !targetEl) {
      throw new Error(`drag target not found: ${source} -> ${target}`);
    }

    const dt = new DataTransfer();
    sourceEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    targetEl.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    targetEl.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    sourceEl.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, { sourceText, targetText });
}

async function dropPdfFiles(page, files) {
  const payload = await Promise.all(files.map(async (filePath) => ({
    name: path.basename(filePath),
    base64: (await readFile(filePath)).toString('base64'),
  })));
  const dataTransfer = await page.evaluateHandle((items) => {
    const transfer = new DataTransfer();
    for (const item of items) {
      const bytes = Uint8Array.from(atob(item.base64), (character) => character.charCodeAt(0));
      transfer.items.add(new File([bytes], item.name, { type: 'application/pdf' }));
    }
    return transfer;
  }, payload);
  const dropZone = page.getByTestId('folder-drop-zone');
  await dropZone.dispatchEvent('dragenter', { dataTransfer });
  await page.getByTestId('pdf-drop-overlay').waitFor({ state: 'visible' });
  await dropZone.dispatchEvent('dragover', { dataTransfer });
  await dropZone.dispatchEvent('drop', { dataTransfer });
  await dataTransfer.dispose();
}

async function tempPdf(root, browser, dirName, fileName, pages, label) {
  const dir = path.join(root, '.tmp', 'acceptance', dirName);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  await writeFile(filePath, await createPageNumberPdf(browser, pages, label));
  return filePath;
}

async function popupFromLink(page, filename) {
  const popupPromise = page.context().waitForEvent('page');
  await page.locator(`a[href*="/viewer/"]`, { hasText: filename }).first().click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  return popup;
}

export const A01 = {
  id: 'A01',
  group: 'A',
  title: 'Integrated service root load',
  seed: seed(),
  run: async ({ page }) => {
    await openHome(page);
    await waitText(page, 'PDFit');
    await page.goto('/viewer', { waitUntil: 'domcontentloaded' });
    await waitText(page, 'PDF Viewer');
  },
};

export const A02 = {
  id: 'A02',
  group: 'A',
  title: 'Integrated settings access',
  seed: seed(),
  run: async ({ page, baseUrl }) => {
    await openHome(page);
    await assert.equal(await page.getByRole('button', { name: 'Settings' }).count(), 1);
    const response = await page.request.get(`${baseUrl}/api/settings/ai-servers`);
    assert.equal(response.status(), 200);
  },
};

export const A03 = {
  id: 'A03',
  group: 'A',
  title: 'Empty state after reset',
  seed: seed(),
  run: async ({ page, baseUrl }) => {
    await openHome(page);
    await assert.deepEqual((await fetchJson(`${baseUrl}/api/folders`)).filter((folder) => !folder.isRoot), []);
    await assert.deepEqual(await fetchJson(`${baseUrl}/api/tags`), []);
    assert.equal(await page.locator('main a[href*="/viewer/"]').count(), 0);
  },
};

export const B01 = {
  id: 'B01',
  group: 'B',
  title: 'Folder creation UI',
  seed: seed(),
  run: async ({ page }) => {
    await openHome(page);
    await iconButton(page, 'CreateNewFolderIcon').click();
    await page.getByLabel('Folder name').fill('Folder: 01 * Demo');
    await page.getByRole('button', { name: 'Create' }).click();
    await waitText(page, 'Folder_ 01 _ Demo');
    await page.getByText('Folder_ 01 _ Demo', { exact: true }).click();
    await waitText(page, 'Folder_ 01 _ Demo');
  },
};

export const B02 = {
  id: 'B02',
  group: 'B',
  title: 'Folder deletion UI',
  seed: seed({
    folders: [{ name: 'delete-me', files: [] }],
  }),
  run: async ({ page }) => {
    await openFolder(page, 'delete-me');
    await waitText(page, 'PDF 0');
    await page.locator('main button:not([disabled])').filter({
      has: page.locator('svg[data-testid="DeleteIcon"]'),
    }).click();
    await page.getByRole('dialog').getByRole('button', { name: '삭제', exact: true }).click();
    await page.waitForURL(/\/$/);
    await waitText(page, 'PDFit');
  },
};

export const B03 = {
  id: 'B03',
  group: 'B',
  title: 'Folder rename API',
  seed: seed({
    folders: [{ name: 'old-folder', files: [] }],
  }),
  run: async ({ page, baseUrl }) => {
    await fetchJson(`${baseUrl}/api/folders/old-folder`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newName: 'renamed-folder' }),
    });
    await openHome(page);
    await waitText(page, 'renamed-folder');
    await assert.equal(await page.getByText('old-folder').count(), 0);
  },
};

export const B04 = {
  id: 'B04',
  group: 'B',
  title: 'PDF drag-and-drop upload UI',
  seed: seed({
    folders: [{ name: 'uploads', files: [] }],
  }),
  run: async ({ page, root, browser }) => {
    await openFolder(page, 'uploads');
    const f1 = await tempPdf(root, browser, 'b04', 'page-1.pdf', 1, 'Upload One');
    const f2 = await tempPdf(root, browser, 'b04', 'page-3.pdf', 3, 'Upload Three');
    await dropPdfFiles(page, [f1, f2]);
    await waitText(page, 'page-1.pdf');
    await waitText(page, 'page-3.pdf');
    await waitText(page, 'PDF 2');
  },
};

export const B05 = {
  id: 'B05',
  group: 'B',
  title: 'PDF open in viewer tab',
  seed: seed({
    folders: [{ name: 'viewer-link', files: [{ name: 'sample.pdf', pages: 3 }] }],
  }),
  run: async ({ page, baseUrl }) => {
    await openFolder(page, 'viewer-link');
    const viewerLink = page.locator('a[href*="/viewer/"]', { hasText: 'sample.pdf' }).first();
    assert.equal(await viewerLink.evaluate((element) => getComputedStyle(element).cursor), 'pointer');
    const metadata = page.getByText(/MB · 수정:/).first();
    assert.notEqual(await metadata.evaluate((element) => getComputedStyle(element).cursor), 'pointer');
    const pageCountBeforeMetadataClick = page.context().pages().length;
    await metadata.click();
    await page.waitForTimeout(150);
    assert.equal(page.context().pages().length, pageCountBeforeMetadataClick);
    const popupPromise = page.context().waitForEvent('page');
    await viewerLink.click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForURL(/\/viewer\/viewer-link\/sample\.pdf/);
    await waitText(popup, 'sample.pdf');
    const response = await page.request.get(`${baseUrl}/api/folders/viewer-link/files/sample.pdf`);
    assert.equal(response.ok(), true);
    assert.match(response.headers()['content-type'] ?? '', /pdf/i);
  },
};

export const B06 = {
  id: 'B06',
  group: 'B',
  title: 'File move dialog',
  seed: seed({
    folders: [
      { name: 'from-folder', files: [{ name: 'move.pdf', pages: 1 }] },
      { name: 'to-folder', files: [] },
    ],
  }),
  run: async ({ page, baseUrl }) => {
    await openFolder(page, 'from-folder');
    await fetchJson(`${baseUrl}/api/folders/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromFolder: 'from-folder', toFolder: 'to-folder', filename: 'move.pdf' }),
    });
    await openFolder(page, 'to-folder');
    await waitText(page, 'move.pdf');
    const fromFiles = await fetchJson(`${baseUrl}/api/folders/from-folder/files`);
    assert.equal(fromFiles.length, 0);
  },
};

export const B07 = {
  id: 'B07',
  group: 'B',
  title: 'File move drag and duplicate guard',
  seed: seed({
    folders: [
      { name: 'drag-src', files: [{ name: 'drag.pdf', pages: 1 }] },
      { name: 'drag-dst', files: [] },
    ],
  }),
  run: async ({ page, baseUrl }) => {
    await openFolder(page, 'drag-src');
    await fetchJson(`${baseUrl}/api/folders/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromFolder: 'drag-src', toFolder: 'drag-dst', filename: 'drag.pdf' }),
    });
    await openFolder(page, 'drag-dst');
    await waitText(page, 'drag.pdf');
    const files = await fetchJson(`${baseUrl}/api/folders/drag-dst/files`);
    assert.equal(files.length, 1);
  },
};

export const B08 = {
  id: 'B08',
  group: 'B',
  title: 'File deletion UI',
  seed: seed({
    folders: [{ name: 'delete-file', files: [{ name: 'gone.pdf', pages: 1 }] }],
  }),
  run: async ({ page, baseUrl }) => {
    await openFolder(page, 'delete-file');
    await fetchJson(`${baseUrl}/api/folders/delete-file/files/gone.pdf`, { method: 'DELETE' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitText(page, 'PDF 0');
    await assert.equal(await page.getByText('gone.pdf').count(), 0);
  },
};

export const C01 = {
  id: 'C01',
  group: 'C',
  title: 'Tag add dialog',
  seed: seed({
    folders: [{ name: 'tag-folder', files: [{ name: 'tag.pdf', pages: 3 }] }],
  }),
  run: async ({ page, baseUrl }) => {
    await openFolder(page, 'tag-folder');
    await page.route('**/api/tags/book/tag-folder/tag.pdf*', async (route) => {
      if (route.request().method() === 'POST' || route.request().method() === 'DELETE') {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      await route.continue();
    });
    await page.getByRole('button', { name: '태그 관리' }).click();
    await page.getByLabel('태그 추가').fill('alpha');
    await page.getByLabel('태그 추가').press('Enter');
    await waitText(page, '"alpha" 태그를 추가하는 중입니다…');
    await waitText(page, 'alpha');
    await waitText(page, '"alpha" 태그가 추가되었습니다.');
    const tags = await fetchJson(`${baseUrl}/api/tags/book/tag-folder/tag.pdf`);
    assert.deepEqual(tags, ['alpha']);
    await page.locator('.MuiChip-root').filter({ hasText: 'alpha' }).locator('.MuiChip-deleteIcon').click();
    await waitText(page, '"alpha" 태그를 삭제하는 중입니다…');
    await waitText(page, '"alpha" 태그가 삭제되었습니다.');
    assert.deepEqual(await fetchJson(`${baseUrl}/api/tags/book/tag-folder/tag.pdf`), []);
  },
};

export const C02 = {
  id: 'C02',
  group: 'C',
  title: 'Existing tag drag add',
  seed: seed({
    folders: [{ name: 'tag-src', files: [{ name: 'tagged.pdf', pages: 1 }] }],
    tags: [{ folder: 'tag-src', filename: 'tagged.pdf', tag: 'seed-tag' }],
  }),
  run: async ({ page, baseUrl }) => {
    await openHome(page);
    await fetchJson(`${baseUrl}/api/tags/book/tag-src/tagged.pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: 'seed-tag' }),
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    const tags = await fetchJson(`${baseUrl}/api/tags/book/tag-src/tagged.pdf`);
    assert.deepEqual(tags.sort(), ['seed-tag']);
  },
};

export const C03 = {
  id: 'C03',
  group: 'C',
  title: 'Tag page and viewer open',
  seed: seed({
    folders: [{ name: 'tag-page', files: [{ name: 'tag-page.pdf', pages: 3 }] }],
    tags: [{ folder: 'tag-page', filename: 'tag-page.pdf', tag: 'topic' }],
  }),
  run: async ({ page }) => {
    await openTag(page, 'topic');
    await waitText(page, 'tag-page.pdf');
    const popup = await popupFromLink(page, 'tag-page.pdf');
    await popup.waitForURL(/\/viewer\/tag-page\/tag-page\.pdf/);
    await waitText(popup, 'tag-page.pdf');
  },
};

export const C04 = {
  id: 'C04',
  group: 'C',
  title: 'Tag removal and orphan cleanup',
  seed: seed({
    folders: [{ name: 'tag-clean', files: [{ name: 'clean.pdf', pages: 1 }] }],
    tags: [{ folder: 'tag-clean', filename: 'clean.pdf', tag: 'orphan-tag' }],
  }),
  run: async ({ page, baseUrl }) => {
    await openFolder(page, 'tag-clean');
    await fetchJson(`${baseUrl}/api/tags/book/tag-clean/clean.pdf/orphan-tag`, { method: 'DELETE' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openHome(page);
    const tags = await fetchJson(`${baseUrl}/api/tags`);
    assert.deepEqual(tags, []);
  },
};

export const C05 = {
  id: 'C05',
  group: 'C',
  title: 'Tag count and delete cascade',
  seed: seed({
    folders: [
      { name: 'tag-a', files: [{ name: 'a.pdf', pages: 1 }] },
      { name: 'tag-b', files: [{ name: 'b.pdf', pages: 1 }] },
    ],
    tags: [
      { folder: 'tag-a', filename: 'a.pdf', tag: 'shared-tag' },
      { folder: 'tag-b', filename: 'b.pdf', tag: 'shared-tag' },
    ],
  }),
  run: async ({ page, baseUrl }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitText(page, 'shared-tag');
    assert.equal(await page.getByText('2', { exact: true }).count() > 0, true);
    await acceptDialog(page);
    await page.getByRole('button', { name: 'Delete tag' }).click();
    await page.waitForTimeout(200);
    assert.deepEqual(await fetchJson(`${baseUrl}/api/tags`), []);
    assert.deepEqual(await fetchJson(`${baseUrl}/api/tags/book/tag-a/a.pdf`), []);
    assert.deepEqual(await fetchJson(`${baseUrl}/api/tags/book/tag-b/b.pdf`), []);
  },
};

export const D01 = {
  id: 'D01',
  group: 'D',
  title: 'Viewer direct entry and back header',
  seed: seed({
    folders: [{ name: 'viewer-direct', files: [{ name: 'direct.pdf', pages: 3 }] }],
  }),
  run: async ({ page }) => {
    await openViewer(page, 'viewer-direct', 'direct.pdf');
    await waitText(page, 'direct.pdf');
    await page.getByRole('button').first().click();
    await waitText(page, 'viewer-direct');
  },
};

export const D02 = {
  id: 'D02',
  group: 'D',
  title: 'Viewer page movement',
  seed: seed({
    folders: [{ name: 'viewer-nav', files: [{ name: 'nav.pdf', pages: 3 }] }],
  }),
  run: async ({ page }) => {
    await openViewer(page, 'viewer-nav', 'nav.pdf');
    const pageInput = page.locator('input[type="text"]').first();
    assert.equal(await pageInput.inputValue(), '1');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(250);
    assert.equal(await pageInput.inputValue(), '2');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(250);
    assert.equal(await pageInput.inputValue(), '1');
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(250);
    assert.equal(await pageInput.inputValue(), '2');
    await page.keyboard.press('PageUp');
    await page.waitForTimeout(250);
    assert.equal(await pageInput.inputValue(), '1');
  },
};

export const D03 = {
  id: 'D03',
  group: 'D',
  title: 'Viewer zoom fit and invert',
  seed: seed({
    folders: [{ name: 'viewer-zoom', files: [{ name: 'zoom.pdf', pages: 3 }] }],
  }),
  run: async ({ page }) => {
    await openViewer(page, 'viewer-zoom', 'zoom.pdf');
    const scaleLabel = page.locator('text=/\\d+%/').first();
    const before = parseInt((await scaleLabel.textContent()) ?? '0', 10);
    await iconButton(page, 'ZoomInIcon').click();
    await page.waitForFunction(({ beforeValue }) => {
      const body = document.body.innerText;
      const match = body.match(/(\d+)%/);
      const value = match ? parseInt(match[1], 10) : NaN;
      return Number.isFinite(value) && value > beforeValue;
    }, { beforeValue: before });
    await iconButton(page, 'FitScreenIcon').click();
    await iconButton(page, 'InvertColorsIcon').click();
    const filter = await page.locator('canvas').first().evaluate((el) => getComputedStyle(el).filter);
    assert.match(filter, /invert/i);
  },
};

export const D04 = {
  id: 'D04',
  group: 'D',
  title: 'Viewer modes and wheel paging',
  seed: seed({
    folders: [{ name: 'viewer-mode', files: [{ name: 'mode.pdf', pages: 6 }] }],
  }),
  run: async ({ page }) => {
    await openViewer(page, 'viewer-mode', 'mode.pdf');
    await iconButton(page, 'CropPortraitIcon').click();
    await iconButton(page, 'MenuBookIcon').click();
    const pageInput = page.locator('input[type="text"]').first();
    const before = await pageInput.inputValue();
    await page.locator('canvas').first().hover();
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(300);
    assert.notEqual(await pageInput.inputValue(), before);
  },
};

export const D05 = {
  id: 'D05',
  group: 'D',
  title: 'Viewer UI remains visible during reading interactions',
  seed: seed({
    folders: [{ name: 'viewer-ui', files: [{ name: 'ui.pdf', pages: 1 }] }],
  }),
  run: async ({ page }) => {
    await openViewer(page, 'viewer-ui', 'ui.pdf');
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
    assert.equal(await page.locator(`svg[data-testid="NavigateBeforeIcon"]`).count(), 1);
    const mainBox = await page.getByRole('main').boundingBox();
    assert.notEqual(mainBox, null);
    await page.mouse.click(mainBox.x + mainBox.width / 2, mainBox.y + mainBox.height / 2);
    await page.waitForTimeout(150);
    assert.equal(await page.locator(`svg[data-testid="NavigateBeforeIcon"]`).count(), 1);
  },
};

export const E01 = {
  id: 'E01',
  group: 'E',
  title: 'Viewer state restore',
  seed: seed({
    folders: [{ name: 'viewer-state', files: [{ name: 'state.pdf', pages: 6 }] }],
    viewerStates: [{
      page: 3,
      scale: 1.5,
      fitMode: 'width',
      viewMode: 'single',
      inverted: true,
      uiHidden: true,
      scrollTop: 120,
      folder: 'viewer-state',
      filename: 'state.pdf',
    }],
  }),
  run: async ({ page, baseUrl }) => {
    await openViewer(page, 'viewer-state', 'state.pdf');
    let state = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      state = await fetchJson(`${baseUrl}/api/viewer-state/viewer-state/state.pdf`);
      if (state?.fitMode === 'none' && state.uiHidden === false) break;
      await page.waitForTimeout(250);
    }
    assert.notEqual(state, null);
    assert.equal(state.page, 3);
    assert.equal(state.scale, 1.2);
    assert.equal(state.fitMode, 'none');
    assert.equal(state.viewMode, 'single');
    assert.equal(state.inverted, true);
    assert.equal(state.uiHidden, false);
    assert.equal(await page.locator('svg[data-testid="NavigateBeforeIcon"]').count(), 1);
    assert.equal(await iconButton(page, 'FitScreenIcon').getAttribute('class').then((value) => value?.includes('MuiIconButton-colorPrimary') ?? false), false);
    assert.equal(await iconButton(page, 'HeightIcon').getAttribute('class').then((value) => value?.includes('MuiIconButton-colorPrimary') ?? false), false);
  },
};

export const E02 = {
  id: 'E02',
  group: 'E',
  title: 'Progress API',
  seed: seed({
    folders: [{ name: 'progress', files: [{ name: 'progress.pdf', pages: 3 }] }],
    progress: [{ folder: 'progress', filename: 'progress.pdf', page: 2 }],
  }),
  run: async ({ baseUrl }) => {
    const data = await fetchJson(`${baseUrl}/api/progress/progress/progress.pdf`);
    assert.equal(data.page, 2);
    await fetchJson(`${baseUrl}/api/progress/progress/progress.pdf`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: 3 }),
    });
    const updated = await fetchJson(`${baseUrl}/api/progress/progress/progress.pdf`);
    assert.equal(updated.page, 3);
  },
};

export const E03 = {
  id: 'E03',
  group: 'E',
  title: 'SSE refresh',
  seed: seed({
    folders: [{ name: 'sse', files: [{ name: 'sse.pdf', pages: 1 }] }],
  }),
  run: async ({ page, baseUrl }) => {
    const eventStreamReady = page.waitForResponse((response) => (
      response.url().endsWith('/api/events') && response.status() === 200
    ));
    await openHome(page);
    await eventStreamReady;
    await fetchJson(`${baseUrl}/api/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'sse-new' }),
    });
    await waitText(page, 'sse-new');
  },
};

export const E04 = {
  id: 'E04',
  group: 'E',
  title: 'File delete purge',
  seed: seed({
    folders: [{ name: 'purge-file', files: [{ name: 'purge.pdf', pages: 1 }] }],
    tags: [{ folder: 'purge-file', filename: 'purge.pdf', tag: 'purged' }],
    progress: [{ folder: 'purge-file', filename: 'purge.pdf', page: 1 }],
  }),
  run: async ({ baseUrl }) => {
    await fetchJson(`${baseUrl}/api/folders/purge-file/files/purge.pdf`, { method: 'DELETE' });
    assert.deepEqual(await fetchJson(`${baseUrl}/api/tags`), []);
  },
};

export const E05 = {
  id: 'E05',
  group: 'E',
  title: 'Folder delete purge',
  seed: seed({
    folders: [{ name: 'purge-folder', files: [{ name: 'purge-folder.pdf', pages: 1 }] }],
    tags: [{ folder: 'purge-folder', filename: 'purge-folder.pdf', tag: 'gone' }],
  }),
  run: async ({ baseUrl }) => {
    await fetchJson(`${baseUrl}/api/folders/purge-folder`, { method: 'DELETE' });
    const folders = await fetchJson(`${baseUrl}/api/folders`);
    assert.deepEqual(folders.filter((folder) => !folder.isRoot), []);
  },
};

export const E06 = {
  id: 'E06',
  group: 'E',
  title: 'Boundary combination scenario',
  seed: seed({
    folders: [{ name: 'combo-a', files: [{ name: 'combo.pdf', pages: 6 }] }],
  }),
  run: async ({ page, baseUrl }) => {
    await openFolder(page, 'combo-a');
    await fetchJson(`${baseUrl}/api/tags/book/combo-a/combo.pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: 'combo-tag' }),
    });
    await openViewer(page, 'combo-a', 'combo.pdf');
    await page.keyboard.press('Space');
    await page.keyboard.press('Space');
    await openFolder(page, 'combo-a');
    await waitText(page, 'combo-tag');
    await fetchJson(`${baseUrl}/api/folders/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromFolder: 'combo-a', toFolder: 'combo-a', filename: 'combo.pdf' }),
    }).catch(() => {});
    await fetchJson(`${baseUrl}/api/folders/combo-a/files/combo.pdf`, { method: 'DELETE' });
  },
};

export const F01 = {
  id: 'F01',
  group: 'F',
  title: 'Viewer page input and keyboard matrix',
  seed: seed({
    folders: [{ name: 'viewer-matrix-input', files: [{ name: 'matrix-input.pdf', pages: 6 }] }],
  }),
  run: async ({ page }) => {
    await openViewer(page, 'viewer-matrix-input', 'matrix-input.pdf');
    const pageInput = page.locator('input[type="text"]').first();
    const modes = [
      { icon: 'ViewStreamIcon', page: 4 },
      { icon: 'CropPortraitIcon', page: 4 },
      { icon: 'MenuBookIcon', page: 3 },
    ];
    for (const mode of modes) {
      await iconButton(page, mode.icon).click();
      await pageInput.fill(String(mode.page));
      await pageInput.press('Enter');
      await page.waitForFunction((expected) => document.querySelector('input[type="text"]')?.value === expected, String(mode.page));
      await page.locator('canvas').first().focus().catch(() => {});
      await page.keyboard.press('PageUp');
      await page.waitForTimeout(180);
      assert.notEqual(await pageInput.inputValue(), '0');
    }

    await pageInput.fill('2');
    await pageInput.press('ArrowRight');
    await page.waitForTimeout(100);
    assert.equal(await pageInput.inputValue(), '2');
  },
};

export const F02 = {
  id: 'F02',
  group: 'F',
  title: 'Viewer native scroll and page wheel modes',
  seed: seed({
    folders: [{ name: 'viewer-matrix-wheel', files: [{ name: 'matrix-wheel.pdf', pages: 8 }] }],
  }),
  run: async ({ page }) => {
    await openViewer(page, 'viewer-matrix-wheel', 'matrix-wheel.pdf');
    const pageInput = page.locator('input[type="text"]').first();
    const canvas = page.locator('canvas').first();

    await iconButton(page, 'ViewStreamIcon').click();
    await canvas.hover();
    const scrollBefore = await pageInput.inputValue();
    await page.mouse.wheel(0, 1400);
    await page.waitForFunction((before) => (document.querySelector('input[type="text"]')?.value ?? '') !== before, scrollBefore);

    await iconButton(page, 'CropPortraitIcon').click();
    await pageInput.fill('1');
    await pageInput.press('Enter');
    await canvas.hover();
    await page.mouse.wheel(0, 900);
    await page.waitForFunction(() => document.querySelector('input[type="text"]')?.value === '2');

    await iconButton(page, 'MenuBookIcon').click();
    await pageInput.fill('1');
    await pageInput.press('Enter');
    await canvas.hover();
    await page.mouse.wheel(0, 900);
    await page.waitForFunction(() => document.querySelector('input[type="text"]')?.value === '3');
  },
};

export const F03 = {
  id: 'F03',
  group: 'F',
  title: 'Viewer UI, inversion, scrollbar, and persisted restore order',
  seed: seed({
    folders: [{ name: 'viewer-matrix-state', files: [{ name: 'matrix-state.pdf', pages: 6 }] }],
  }),
  run: async ({ page, baseUrl }) => {
    await openViewer(page, 'viewer-matrix-state', 'matrix-state.pdf');
    await iconButton(page, 'ViewStreamIcon').click();
    await iconButton(page, 'InvertColorsIcon').click();
    const viewport = page.locator('[data-testid="pdfgpu-scroll-area"], [data-testid="pdf-scroll-area"]').first();
    await viewport.evaluate((element) => {
      const target = element;
      target.scrollTop = Math.max(1, target.scrollHeight / 2);
      target.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await page.waitForTimeout(300);
    const viewerMain = page.getByRole('main');
    const mainBox = await viewerMain.boundingBox();
    assert.notEqual(mainBox, null);
    await page.mouse.click(mainBox.x + mainBox.width / 6, mainBox.y + mainBox.height / 2);
    await page.waitForTimeout(120);
    assert.equal(await page.getByRole('toolbar', { name: 'viewer controls' }).count(), 1);
    await page.getByRole('button', { name: '북마크 사이드바 열기' }).click();
    assert.equal(await page.getByRole('complementary', { name: 'Book bookmarks' }).count(), 1);
    await page.getByRole('button', { name: '북마크 사이드바 닫기' }).click();
    assert.equal(await page.getByRole('complementary', { name: 'Book bookmarks' }).count(), 0);
    await page.mouse.click(mainBox.x + mainBox.width / 2, mainBox.y + mainBox.height / 2);
    await page.waitForTimeout(120);
    assert.equal(await page.getByRole('toolbar', { name: 'viewer controls' }).count(), 1);
    await page.keyboard.press('Space');
    await page.waitForTimeout(120);
    assert.equal(await page.getByRole('toolbar', { name: 'viewer controls' }).count(), 1);

    const stateUrl = `${baseUrl}/api/viewer-state/viewer-matrix-state/matrix-state.pdf`;
    let state = null;
    for (let attempt = 0; attempt < 20 && state === null; attempt += 1) {
      const response = await page.request.get(stateUrl);
      assert.equal(response.ok(), true);
      state = await response.json();
      if (state === null) await page.waitForTimeout(250);
    }
    assert.notEqual(state, null);
    assert.equal(state.viewMode, 'scroll');
    assert.equal(state.inverted, true);
    assert.equal(state.uiHidden, false);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    assert.equal(await page.getByRole('toolbar', { name: 'viewer controls' }).count(), 1);
    assert.match(await page.locator('canvas').first().evaluate((element) => getComputedStyle(element).filter), /invert/i);
  },
};

export const F04 = {
  id: 'F04',
  group: 'F',
  title: 'Always-available bookmark capture and fresh delete affordance',
  seed: seed({
    folders: [{ name: 'viewer-bookmark-always', files: [{ name: 'bookmark-always.pdf', pages: 2 }] }],
  }),
  run: async ({ page }) => {
    await openViewer(page, 'viewer-bookmark-always', 'bookmark-always.pdf');
    assert.equal(await page.getByRole('complementary', { name: 'Book bookmarks' }).count(), 0);

    const canvas = page.locator('canvas').first();
    const canvasBox = await canvas.boundingBox();
    assert.notEqual(canvasBox, null);
    const start = { x: canvasBox.x + canvasBox.width * 0.2, y: canvasBox.y + canvasBox.height * 0.2 };
    const end = { x: start.x + 16, y: start.y + 16 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 });
    await page.getByTestId('bookmark-drag-preview').waitFor({ state: 'visible' });
    const createdResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/api/bookmarks/'));
    await page.mouse.up();
    assert.equal((await createdResponse).ok(), true);
    await page.getByText('북마크가 저장되었습니다.', { exact: true }).waitFor({ state: 'visible' });

    const overlay = page.getByTestId('bookmark-page-overlay').first();
    await overlay.waitFor({ state: 'visible' });
    const deleteButton = overlay.getByTestId('bookmark-overlay-delete');
    assert.ok(Number(await deleteButton.evaluate((element) => getComputedStyle(element).opacity)) > 0.9);
    await page.waitForFunction((element) => Number(getComputedStyle(element).opacity) < 0.6, await deleteButton.elementHandle(), { timeout: 7000 });

    await page.getByRole('button', { name: '북마크 사이드바 열기' }).click();
    assert.equal(await page.getByTestId('bookmark-card').count(), 1);
    await deleteButton.click();
    await overlay.waitFor({ state: 'detached' });
  },
};

export const F05 = {
  id: 'F05',
  group: 'F',
  title: 'Legacy fallback bookmark capture and sidebar control',
  seed: seed({
    folders: [{ name: 'viewer-bookmark-legacy', files: [{ name: 'bookmark-legacy.pdf', pages: 2 }] }],
  }),
  run: async ({ page }) => {
    await page.goto('/viewer/viewer-bookmark-legacy/bookmark-legacy.pdf?engine=legacy', { waitUntil: 'domcontentloaded' });
    await waitText(page, 'bookmark-legacy.pdf');
    const canvas = page.locator('[data-pdf-page] canvas').first();
    await canvas.waitFor({ state: 'visible' });
    await page.getByTestId('legacy-bookmark-sidebar-toggle').waitFor({ state: 'visible' });

    const canvasBox = await canvas.boundingBox();
    assert.notEqual(canvasBox, null);
    const start = { x: canvasBox.x + 30, y: canvasBox.y + 30 };
    const end = { x: start.x + 20, y: start.y + 20 };
    const createdResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/api/bookmarks/'));
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 4 });
    await page.getByTestId('legacy-bookmark-drag-preview').waitFor({ state: 'visible' });
    await page.mouse.up();
    assert.equal((await createdResponse).ok(), true);
    await page.getByText('북마크가 저장되었습니다.', { exact: true }).waitFor({ state: 'visible' });
    await page.getByTestId('legacy-bookmark-overlay').waitFor({ state: 'visible' });

    await page.getByRole('button', { name: '북마크 사이드바 열기' }).click();
    assert.equal(await page.getByTestId('legacy-bookmark-card').count(), 1);
    await page.getByRole('button', { name: '북마크 사이드바 닫기' }).click();
    await page.getByTestId('legacy-bookmark-delete').click();
    await page.getByTestId('legacy-bookmark-overlay').waitFor({ state: 'detached' });
  },
};

export const CASES = [
  A01, A02, A03,
  B01, B02, B03, B04, B05, B06, B07, B08,
  C01, C02, C03, C04,
  D01, D02, D03, D04, D05,
  E01, E02, E03, E04, E05, E06,
  F01, F02, F03, F04, F05,
];
