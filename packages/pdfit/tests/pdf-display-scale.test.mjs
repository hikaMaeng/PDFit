import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_VIEWER_ZOOM,
  PDF_CSS_UNITS,
  fitZoomForCssExtent,
  toPdfJsViewportScale,
} from '../dist/front/components/PdfViewer/pdfDisplayScale.js';

test('documents without saved viewer state start at 100%', () => {
  assert.equal(DEFAULT_VIEWER_ZOOM, 1);
});

test('100% zoom maps PDF points to 96-DPI CSS pixels', () => {
  assert.equal(PDF_CSS_UNITS, 4 / 3);
  assert.equal(toPdfJsViewportScale(1), 4 / 3);
  assert.equal(612 * toPdfJsViewportScale(1), 816);
  assert.equal(792 * toPdfJsViewportScale(1), 1056);
});

test('fit zoom converts CSS extents back to the displayed zoom ratio', () => {
  assert.equal(fitZoomForCssExtent(816, 612), 1);
  assert.equal(fitZoomForCssExtent(1020, 612), 1.25);
});
