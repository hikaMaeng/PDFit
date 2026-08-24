import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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
