import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createViewerInteractionState,
  normalizeDetailDpi,
  reduceViewerInteraction,
  viewerModeParts
} from '@pdfgpu/core';
import { isPointInViewerCenterGrid, ViewerSessionModel } from '../dist/front/viewer/sessionModel.js';
import { interpolatePdfGpuDisplayProgress } from '../dist/front/components/PdfGpuViewer/loadingProgress.js';

describe('PDFit pdfgpu artifact integration', () => {
  it('loads the pinned public core API', () => {
    assert.equal(normalizeDetailDpi(193), 192);
    assert.deepEqual(viewerModeParts('double'), { scrollMode: 'page', viewMode: 'spread' });
  });

  it('keeps interaction behavior framework-independent at the app boundary', () => {
    const state = createViewerInteractionState({ page: 3, pageCount: 6, mode: 'single' });
    const transition = reduceViewerInteraction(state, { type: 'key', key: 'PageDown' });
    assert.equal(transition.effects[0]?.type, 'navigate');
    assert.equal(transition.state.page, 4);
  });

  it('preserves PDFit-only viewer session state', () => {
    const model = new ViewerSessionModel();
    model.dispatch({ type: 'toggleUi' });
    model.dispatch({ type: 'toggleInverted' });
    assert.deepEqual(model.getState(), { uiHidden: true, inverted: true });
  });

  it('maps only the center cell of a 3 by 3 viewer grid to the UI toggle', () => {
    const bounds = { left: 100, top: 50, width: 900, height: 600 };
    assert.equal(isPointInViewerCenterGrid(550, 350, bounds), true);
    assert.equal(isPointInViewerCenterGrid(399, 350, bounds), false);
    assert.equal(isPointInViewerCenterGrid(700, 350, bounds), false);
    assert.equal(isPointInViewerCenterGrid(550, 249, bounds), false);
    assert.equal(isPointInViewerCenterGrid(550, 450, bounds), false);
    assert.equal(isPointInViewerCenterGrid(400, 250, bounds), true);
    assert.equal(isPointInViewerCenterGrid(700, 450, bounds), false);
    assert.equal(isPointInViewerCenterGrid(0, 0, { left: 0, top: 0, width: 0, height: 0 }), false);
  });

  it('interpolates PDFGPU preview progress so 35% fills the displayed gauge', () => {
    assert.equal(interpolatePdfGpuDisplayProgress(0), 0);
    assert.equal(interpolatePdfGpuDisplayProgress(12), 34);
    assert.equal(interpolatePdfGpuDisplayProgress(35), 100);
    assert.equal(interpolatePdfGpuDisplayProgress(70), 100);
  });
});
