import assert from 'node:assert/strict';
import test from 'node:test';
import { compareUnicode } from '../dist/shared/index.js';

// Contract (apps/pdfit/docs/usage.md): a folder's PDFs are ordered by Unicode code point
// of the NFC filename, in the list and the cover view.

test('names sort by code point: digits, capitals, lowercase, Hangul', () => {
  const names = ['파이썬.pdf', 'apple.pdf', 'Zebra.pdf', '10장.pdf', '2장.pdf', '가나.pdf', 'AI 엔지니어링.pdf', '_note.pdf'];
  assert.deepEqual([...names].sort(compareUnicode), ['10장.pdf', '2장.pdf', 'AI 엔지니어링.pdf', 'Zebra.pdf', '_note.pdf', 'apple.pdf', '가나.pdf', '파이썬.pdf']);
});

test('a decomposed Hangul filename sorts with its composed twin', () => {
  const composed = '한글.pdf';
  const decomposed = composed.normalize('NFD');
  assert.notEqual(composed, decomposed);
  assert.equal(compareUnicode(composed, decomposed), 0);
  assert.deepEqual(['하마.pdf', decomposed, '가.pdf'].sort(compareUnicode), ['가.pdf', '하마.pdf', decomposed]);
});

test('characters outside the BMP sort after U+FFFF, by code point not UTF-16 unit', () => {
  const astral = '\u{1F4D8}.pdf'; // U+1F4D8, UTF-16 starts with 0xD83D
  const privateUse = '.pdf';
  assert.ok(astral < privateUse, 'plain string comparison puts the surrogate first');
  assert.equal(compareUnicode(astral, privateUse), 1);
});

test('a prefix sorts first and equal names compare 0', () => {
  assert.ok(compareUnicode('책', '책 2') < 0);
  assert.equal(compareUnicode('같음.pdf', '같음.pdf'), 0);
});
