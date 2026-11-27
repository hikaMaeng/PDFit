import assert from 'node:assert/strict';
import test from 'node:test';
import {
  annotationSvgTransform,
  layerPointToPagePoint,
  pagePointToLayerPoint,
  pageRectToLayerRect,
  projectAnnotationPages,
} from '../dist/front/annotation/coordinates.js';
import { annotationBounds, annotationFromGesture, createTextAnnotation, resizeAnnotation, simplifyInkPoints, translateAnnotation } from '../dist/front/annotation/model.js';
import { reduceAnnotationHistory } from '../dist/front/annotation/history.js';

test('annotation projection uses the PDFGPU page transform', () => {
  const controller = {
    getPageTransform() {
      return { a: 2, b: 0, c: 0, d: 3, e: 24, f: 40 };
    },
  };
  const projection = projectAnnotationPages(controller, [2]).get(2);
  assert.deepEqual(projection, { pageIndex: 2, left: 24, top: 40, scaleX: 2, scaleY: 3 });
  assert.deepEqual(pagePointToLayerPoint(projection, { x: 10, y: 5 }), { x: 44, y: 55 });
  assert.deepEqual(pageRectToLayerRect(projection, { x: 10, y: 5, width: 20, height: 8 }), { x: 44, y: 55, width: 40, height: 24 });
  assert.deepEqual(layerPointToPagePoint(projection, { x: 44, y: 55 }), { x: 10, y: 5 });
  assert.equal(annotationSvgTransform(projection), undefined);
});

test('annotation projection de-duplicates pages and skips missing transforms', () => {
  const requested = [];
  const controller = {
    getPageTransform(pageIndex) {
      requested.push(pageIndex);
      if (pageIndex === 0) return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    },
  };
  const projections = projectAnnotationPages(controller, [0, 0, 1]);
  assert.deepEqual(requested, [0, 1]);
  assert.deepEqual([...projections.keys()], [0]);
});

test('rotated annotation geometry and pointer input use the same transform', () => {
  const angle = -2 * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const matrix = { a: 2 * cos, b: 2 * sin, c: -3 * sin, d: 3 * cos, e: 24, f: 40 };
  const projection = projectAnnotationPages({ getPageTransform: () => matrix }, [0]).get(0);
  const point = { x: 90, y: 190 };
  const groupPoint = pagePointToLayerPoint(projection, point);
  const [a, b, c, d, e, f] = annotationSvgTransform(projection).slice(7, -1).split(' ').map(Number);
  const screenPoint = { x: a * groupPoint.x + c * groupPoint.y + e, y: b * groupPoint.x + d * groupPoint.y + f };
  assert.ok(Math.abs(screenPoint.x - (matrix.a * point.x + matrix.c * point.y + matrix.e)) < 1e-9);
  assert.ok(Math.abs(screenPoint.y - (matrix.b * point.x + matrix.d * point.y + matrix.f)) < 1e-9);
  const restored = layerPointToPagePoint(projection, screenPoint);
  assert.ok(Math.abs(restored.x - point.x) < 1e-9);
  assert.ok(Math.abs(restored.y - point.y) < 1e-9);
});

test('drawing gestures create supported vector annotations', () => {
  const common = { id: 'a', documentId: 'doc', pageIndex: 0, start: { x: 10, y: 20 }, end: { x: 40, y: 60 }, points: [{ x: 10, y: 20 }, { x: 20, y: 30 }, { x: 40, y: 60 }], timestamp: 'now' };
  for (const tool of ['rectangle', 'circle', 'highlight', 'line', 'arrow', 'pen']) assert.ok(annotationFromGesture({ ...common, tool }), tool);
});

test('ink simplification removes dense intermediate samples but preserves endpoints', () => {
  assert.deepEqual(simplifyInkPoints([{ x: 0, y: 0 }, { x: 0.1, y: 0.1 }, { x: 4, y: 4 }]), [{ x: 0, y: 0 }, { x: 4, y: 4 }]);
});

test('selection transforms move and resize geometry in PDF coordinates', () => {
  const annotation = annotationFromGesture({ id: 'r', documentId: 'doc', pageIndex: 0, tool: 'rectangle', start: { x: 10, y: 20 }, end: { x: 30, y: 50 }, points: [], timestamp: 'now' });
  assert.deepEqual(annotationBounds(annotation), { x: 10, y: 20, width: 20, height: 30 });
  assert.deepEqual(annotationBounds(translateAnnotation(annotation, { x: 5, y: -5 }, 'later')), { x: 15, y: 15, width: 20, height: 30 });
  assert.deepEqual(annotationBounds(resizeAnnotation(annotation, 'se', { x: 50, y: 70 }, 'later')), { x: 10, y: 20, width: 40, height: 50 });
});

test('free text preserves multiline content and PDF bounds', () => {
  const annotation = createTextAnnotation({ id: 't', documentId: 'doc', pageIndex: 1, point: { x: 15, y: 25 }, text: '첫 줄\n둘째 줄', width: 140, height: 60, fontSize: 18, timestamp: 'now' });
  assert.equal(annotation.type, 'text');
  assert.equal(annotation.geometry.text, '첫 줄\n둘째 줄');
  assert.deepEqual(annotationBounds(annotation), { x: 15, y: 25, width: 140, height: 60 });
});

test('annotation history treats a previewed drag as one undoable operation', () => {
  const first = [annotationFromGesture({ id: 'r', documentId: 'doc', pageIndex: 0, tool: 'rectangle', start: { x: 0, y: 0 }, end: { x: 10, y: 10 }, points: [], timestamp: 'now' })];
  const moved = [translateAnnotation(first[0], { x: 20, y: 30 }, 'later')];
  let history = { past: [], present: first, future: [] };
  history = reduceAnnotationHistory(history, { type: 'preview', annotations: moved });
  history = reduceAnnotationHistory(history, { type: 'commit-preview', previous: first });
  history = reduceAnnotationHistory(history, { type: 'undo' });
  assert.deepEqual(annotationBounds(history.present[0]), { x: 0, y: 0, width: 10, height: 10 });
  history = reduceAnnotationHistory(history, { type: 'redo' });
  assert.deepEqual(annotationBounds(history.present[0]), { x: 20, y: 30, width: 10, height: 10 });
});
