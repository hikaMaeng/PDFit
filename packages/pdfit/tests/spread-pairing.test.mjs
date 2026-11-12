import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeViewerPage } from '@pdfgpu/core';
import {
  lastSpreadLead,
  spreadLeadPage,
  spreadRowPages,
  stepSpreadRow
} from '../dist/front/viewer/spreadPairing.js';

// Expected rows are written out from the two pairings the reader can choose, not derived
// from the implementation: paired = (1,2),(3,4),(5,6),(7); alone = (1),(2,3),(4,5),(6,7).
const PAGE_COUNT = 7;
const EXPECTED_ROWS = {
  paired: [[1, 2], [3, 4], [5, 6], [7]],
  alone: [[1], [2, 3], [4, 5], [6, 7]]
};

function walkRows(cover) {
  const rows = [];
  let lead = spreadLeadPage(1, PAGE_COUNT, cover);
  for (let guard = 0; guard < PAGE_COUNT + 2; guard += 1) {
    rows.push(spreadRowPages(lead, PAGE_COUNT, cover));
    const next = stepSpreadRow(lead, PAGE_COUNT, cover, 1);
    if (next === lead) break;
    lead = next;
  }
  return rows;
}

describe('PDF.js viewer spread pairing', () => {
  for (const cover of ['paired', 'alone']) {
    it(`${cover}: next walks every row once without overlapping pages`, () => {
      assert.deepEqual(walkRows(cover), EXPECTED_ROWS[cover]);
    });

    it(`${cover}: previous walks the same rows backwards`, () => {
      const rows = [];
      let lead = lastSpreadLead(PAGE_COUNT, cover);
      for (let guard = 0; guard < PAGE_COUNT + 2; guard += 1) {
        rows.unshift(spreadRowPages(lead, PAGE_COUNT, cover));
        const prev = stepSpreadRow(lead, PAGE_COUNT, cover, -1);
        if (prev === lead) break;
        lead = prev;
      }
      assert.deepEqual(rows, EXPECTED_ROWS[cover]);
    });

    it(`${cover}: any page lands on the row that contains it`, () => {
      for (const row of EXPECTED_ROWS[cover]) {
        for (const page of row) {
          assert.deepEqual(spreadRowPages(spreadLeadPage(page, PAGE_COUNT, cover), PAGE_COUNT, cover), row, `page ${page}`);
        }
      }
    });
  }

  it('clamps out-of-range pages and handles an empty document', () => {
    assert.equal(spreadLeadPage(0, PAGE_COUNT, 'paired'), 1);
    assert.equal(spreadLeadPage(99, PAGE_COUNT, 'alone'), 6);
    assert.deepEqual(spreadRowPages(1, 0, 'paired'), []);
  });

  it('documents why the shared core rule is not used for paired rows', () => {
    // @pdfgpu/core 0.1.10 normalizes double mode to cover-alone rows only.
    assert.equal(normalizeViewerPage(3, PAGE_COUNT, 'double'), 2);
    assert.equal(spreadLeadPage(3, PAGE_COUNT, 'paired'), 3);
  });
});
