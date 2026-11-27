import assert from 'node:assert/strict';
import test from 'node:test';
import { PageTextModel } from '../dist/front/viewer/text-selection/pageTextModel.js';

const nextTask = () => new Promise(setImmediate);
const pdf = (text) => ({ source: 'pdf', width: 300, height: 400,
  runs: [{ text, x: 10, y: 10, width: 80, height: 12 }] });

test('changing visible pages drops stale text, and toggling the tool reuses cached text', async () => {
  const model = new PageTextModel();
  const requests = [];
  model.connect((page, signal) => new Promise((resolve) => requests.push({ page, signal, resolve })));
  model.show([0, 1]);
  model.show([2]);
  assert.equal(requests[0].signal.aborted, true);
  requests[0].resolve(pdf('old page'));
  await nextTask();
  assert.deepEqual(requests.map((request) => request.page), [0, 2]);
  assert.equal(model.getPage(0), undefined);
  requests[1].resolve(pdf('visible page'));
  await nextTask();
  model.show([]);
  model.show([2]);
  assert.equal(model.getPage(2).runs[0].text, 'visible page');
  assert.equal(requests.length, 2);
});

test('disconnect releases the job immediately when the old document is still closing', async () => {
  const model = new PageTextModel();
  let finishOld;
  const disconnect = model.connect(() => new Promise((resolve) => { finishOld = resolve; }));
  model.show([0]);
  disconnect();
  model.connect(async () => pdf('new document'));
  await nextTask();
  finishOld(pdf('old document'));
  await nextTask();
  assert.equal(model.getPage(0).runs[0].text, 'new document');
});
