import assert from 'node:assert/strict';
import test from 'node:test';
import {
  layerPointToPagePoint,
  pagePointToLayerPoint,
  pageRectToLayerRect,
  projectAnnotationPages,
} from '../dist/front/annotation/coordinates.js';
import { annotationBounds, annotationFromGesture, createTextAnnotation, resizeAnnotation, simplifyInkPoints, translateAnnotation } from '../dist/front/annotation/model.js';

test('annotation projection uses PDFGPU overlay coordinates as the canonical transform', () => {
  const controller = {
    projectOverlays(items) {
      return items.map((item) => ({
        ...item,
        left: 24 + item.rect.x * 2,
        top: 40 + item.rect.y * 3,
        width: item.rect.width * 2,
        height: item.rect.height * 3,
      }));
    },
  };
  const projection = projectAnnotationPages(controller, [2]).get(2);
  assert.deepEqual(projection, { pageIndex: 2, left: 24, top: 40, scaleX: 2, scaleY: 3 });
  assert.deepEqual(pagePointToLayerPoint(projection, { x: 10, y: 5 }), { x: 44, y: 55 });
  assert.deepEqual(pageRectToLayerRect(projection, { x: 10, y: 5, width: 20, height: 8 }), { x: 44, y: 55, width: 40, height: 24 });
  assert.deepEqual(layerPointToPagePoint(projection, { x: 44, y: 55 }), { x: 10, y: 5 });
});

test('annotation projection de-duplicates visible pages', () => {
  let count = 0;
  const controller = {
    projectOverlays(items) {
      count = items.length;
      return items.map((item) => ({ ...item, left: 0, top: 0, width: 1, height: 1 }));
    },
  };
  projectAnnotationPages(controller, [0, 0, 1]);
  assert.equal(count, 2);
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
