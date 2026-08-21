import assert from 'node:assert/strict';
import test from 'node:test';
import {
  layerPointToPagePoint,
  pagePointToLayerPoint,
  pageRectToLayerRect,
  projectAnnotationPages,
} from '../dist/front/annotation/coordinates.js';

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
