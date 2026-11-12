import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createViewerInteractionState,
  normalizeDetailDpi,
  reduceViewerInteraction,
  viewerModeParts
} from '@pdfgpu/core';
import { ViewerSessionModel } from '../dist/front/viewer/sessionModel.js';
import { interpolatePdfGpuDisplayProgress } from '../dist/front/components/PdfGpuViewer/loadingProgress.js';

describe('PDFit pdfgpu artifact integration', () => {
  it('loads the pinned public core API', () => {
    assert.equal(normalizeDetailDpi(193), 192);
    assert.deepEqual(viewerModeParts('double'), { scrollMode: 'page', viewMode: 'spread' });
  });

  it('converts PDFium pixels to ImageData without swapping red and blue', async () => {
    // 0.1.9 rendered with FPDF_REVERSE_BYTE_ORDER (R,G,B,x) and then swapped bytes 0 and 2,
    // so red showed as blue. PDFit carried a local 0.1.9-pdfit.1 patch for that; 0.1.10
    // fixes it upstream by keeping the flag and only filling alpha.
    const entry = fileURLToPath(import.meta.resolve('@pdfgpu/core'));
    const engineDir = join(dirname(entry), 'engine');
    const core = readFileSync(join(engineDir, 'pdfiumCore.js'), 'utf8');
    assert.match(core, /const RENDER_FLAGS = FPDF_REVERSE_BYTE_ORDER;/);
    const { FPDF_REVERSE_BYTE_ORDER, pdfiumRgbxToRgba } = await import(pathToFileURL(join(engineDir, 'pixels.js')).href);
    assert.equal(FPDF_REVERSE_BYTE_ORDER, 0x10);
    // red, green, blue pixels as PDFium writes them with the flag (x = unspecified byte)
    const rgbx = new Uint8ClampedArray([255, 0, 0, 7, 0, 255, 0, 0, 0, 0, 255, 99]);
    assert.deepEqual([...pdfiumRgbxToRgba(rgbx)], [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
  });

  it('ships the PDFium worker next to the engine that loads it', () => {
    const entry = fileURLToPath(import.meta.resolve('@pdfgpu/core'));
    const engineDir = join(dirname(entry), 'engine');
    const engine = readFileSync(join(engineDir, 'pdfiumEngine.js'), 'utf8');
    assert.match(engine, /new Worker\(new URL\('\.\/pdfiumWorkerMain\.js', import\.meta\.url\)/);
    assert.ok(existsSync(join(engineDir, 'pdfiumWorkerMain.js')));
  });

  it('keeps interaction behavior framework-independent at the app boundary', () => {
    const state = createViewerInteractionState({ page: 3, pageCount: 6, mode: 'single' });
    const transition = reduceViewerInteraction(state, { type: 'key', key: 'PageDown' });
    assert.equal(transition.effects[0]?.type, 'navigate');
    assert.equal(transition.state.page, 4);
  });

  it('preserves PDFit-only viewer session state', () => {
    const model = new ViewerSessionModel();
    model.dispatch({ type: 'toggleInverted' });
    assert.deepEqual(model.getState(), { uiHidden: false, inverted: true });
  });

  it('interpolates PDFGPU preview progress so 35% fills the displayed gauge', () => {
    assert.equal(interpolatePdfGpuDisplayProgress(0), 0);
    assert.equal(interpolatePdfGpuDisplayProgress(12), 34);
    assert.equal(interpolatePdfGpuDisplayProgress(35), 100);
    assert.equal(interpolatePdfGpuDisplayProgress(70), 100);
  });
});
