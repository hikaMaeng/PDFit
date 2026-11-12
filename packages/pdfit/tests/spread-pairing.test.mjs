import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createViewerInteractionState, reduceViewerInteraction } from '@pdfgpu/core';
import {
  lastSpreadLead,
  nextSpreadToggleMemory,
  spreadLeadPage,
  spreadRowPages,
  spreadToggleTarget
} from '../dist/front/viewer/spreadPairing.js';

// Expected rows are written out from the two pairings the reader can choose, not derived
// from the implementation: paired = (1,2),(3,4),(5,6),(7); alone = (1),(2,3),(4,5),(6,7).
const PAGE_COUNT = 7;
const EXPECTED_ROWS = {
  paired: [[1, 2], [3, 4], [5, 6], [7]],
  alone: [[1], [2, 3], [4, 5], [6, 7]]
};

// Walks rows with the shared key reducer both viewers use (PageDown / PageUp).
function walk(cover, key, startPage) {
  let state = createViewerInteractionState({ page: startPage, pageCount: PAGE_COUNT, mode: 'double', pairing: cover });
  const rows = [spreadRowPages(state.page, PAGE_COUNT, cover)];
  for (let guard = 0; guard < PAGE_COUNT + 2; guard += 1) {
    const before = state.page;
    state = reduceViewerInteraction(state, { type: 'key', key }).state;
    if (state.page === before) break;
    rows.push(spreadRowPages(state.page, PAGE_COUNT, cover));
  }
  return rows;
}

describe('two-page spread pairing (PDFit helpers over @pdfgpu/core 0.1.11)', () => {
  for (const cover of ['paired', 'alone']) {
    it(`${cover}: PageDown walks every row once without overlapping pages`, () => {
      assert.deepEqual(walk(cover, 'PageDown', 1), EXPECTED_ROWS[cover]);
    });

    it(`${cover}: PageUp walks the same rows backwards`, () => {
      assert.deepEqual(walk(cover, 'PageUp', lastSpreadLead(PAGE_COUNT, cover)), [...EXPECTED_ROWS[cover]].reverse());
    });

    it(`${cover}: any page lands on the row that contains it`, () => {
      for (const row of EXPECTED_ROWS[cover]) {
        for (const page of row) {
          assert.deepEqual(spreadRowPages(page, PAGE_COUNT, cover), row, `page ${page}`);
          assert.equal(spreadLeadPage(page, PAGE_COUNT, cover), row[0], `page ${page}`);
        }
      }
    });
  }

  it('clamps out-of-range pages and handles an empty document', () => {
    assert.equal(spreadLeadPage(0, PAGE_COUNT, 'paired'), 1);
    assert.equal(spreadLeadPage(99, PAGE_COUNT, 'alone'), 6);
    assert.deepEqual(spreadRowPages(1, 0, 'paired'), []);
  });

  it('switching straight back returns to the page the reader switched from', () => {
    // alone (2,3) -> paired lands on (1,2); without memory, back to alone would land on (1).
    let memory = null;
    let page = 2;
    const target1 = spreadToggleTarget(memory, page);
    memory = nextSpreadToggleMemory(memory, page, PAGE_COUNT, 'paired');
    page = spreadLeadPage(target1, PAGE_COUNT, 'paired');
    assert.deepEqual(spreadRowPages(page, PAGE_COUNT, 'paired'), [1, 2]);
    const target2 = spreadToggleTarget(memory, page);
    memory = nextSpreadToggleMemory(memory, page, PAGE_COUNT, 'alone');
    page = spreadLeadPage(target2, PAGE_COUNT, 'alone');
    assert.deepEqual(spreadRowPages(page, PAGE_COUNT, 'alone'), [2, 3]);
    // After navigating away the memory no longer applies.
    assert.equal(spreadToggleTarget(memory, 4), 4);
  });
});
