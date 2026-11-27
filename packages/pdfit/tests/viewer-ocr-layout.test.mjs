import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOcrRuns } from '../dist/front/viewer/text-selection/ocrLayout.js';

const line = (y, words) => ({
  text: words.map(([text]) => text).join(' '),
  bbox: { x0: words[0][1], x1: words.at(-1)[2], y0: y, y1: y + 20 },
  words: words.map(([text, x0, x1]) => ({ text, bbox: { x0, x1, y0: y, y1: y + 19 } })),
});

const blocks = (...lines) => [{ paragraphs: [{ lines }] }];
const clipboard = (runs) => runs.map(({ before, text }) => (before ?? '') + text).join('');

test('OCR copy removes syllable gaps and keeps actual word boundaries', () => {
  const words = [['한', 20, 58], ['글', 39, 55], ['문서', 62, 97], ['에', 100, 115],
    ['새', 123, 138], ['문', 147, 164], ['장', 166, 181], ['을', 185, 200], ['쓴다', 209, 244], ['.', 246, 248]];
  const runs = buildOcrRuns(blocks(line(20, words)), 0.5, 0.5);
  assert.equal(clipboard(runs), '한글 문서에 새 문장을 쓴다.');
  assert.equal(runs.length, words.length);
  assert.deepEqual(runs[0], { text: '한', before: undefined, x: 10, y: 10, width: 19, height: 9.5 });
});

test('OCR copy reflows Korean prose while preserving headings, code, and paragraph breaks', () => {
  const runningHeader = line(0, [['작업 문서 설명', 660, 851]]);
  const heading = line(80, [['처리 방법', 62, 144]]);
  const first = line(115, [['정해진 순서대로 입력 내용을 모두 확인하는 단계', 63, 385]]);
  const continuation = line(153, [['이다.', 64, 103], ['필요한 값은 별도 인수로', 113, 361], ['전', 370, 386]]);
  const last = line(190, [['달', 63, 80], ['된다.', 80, 120], ['이어 결과를 기록한다.', 129, 257]]);
  const code = line(240, [['run(value);', 90, 220]]);
  const codeNext = line(268, [['return result;', 90, 221]]);
  const runs = buildOcrRuns(blocks(runningHeader, heading, first, continuation, last, code, codeNext), 1, 1);
  assert.equal(clipboard(runs), [
    '작업 문서 설명',
    '처리 방법',
    '정해진 순서대로 입력 내용을 모두 확인하는 단계이다. 필요한 값은 별도 인수로 전달된다. 이어 결과를 기록한다.',
    'run(value);',
    'return result;',
  ].join('\n'));
});

test('OCR copy preserves spaces after common standalone syllables at a soft wrap', () => {
  const first = line(50, [['같은 절차를 반복해 입력을 조금', 20, 355], ['더', 364, 382]]);
  const second = line(88, [['처리한다.', 20, 91], ['다양한 입력도 허용한다.', 103, 307]]);
  assert.equal(clipboard(buildOcrRuns(blocks(first, second), 1, 1)), '같은 절차를 반복해 입력을 조금 더 처리한다. 다양한 입력도 허용한다.');
});
