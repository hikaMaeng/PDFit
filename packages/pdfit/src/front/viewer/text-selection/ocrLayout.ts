import type { Block, Line, Word } from 'tesseract.js';
import type { PageTextRun } from './pageTextModel.js';

const HANGUL_TAIL = /[가-힣]$/u;
const HANGUL_HEAD = /^[가-힣]/u;
const CLOSING_PUNCTUATION = /^[,.!?;:%)\]}、。]+$/u;
const OPENING_PUNCTUATION = /^[(\[{]+$/u;
const COPULA = /^(?:이다|이었다|였다|입니다|이었으며|이며|이고|이라면|이라는|이라고)(?:\p{P}|\s|$)/u;
const PREDICATE = /(?:된다|한다|됐다|했다|됩니다|합니다|되며|하며)[.!?。]?$/u;
const STANDALONE_SYLLABLES = new Set('이 그 저 한 두 세 첫 둘 또 더 덜 잘 못 안 늘 각 수 등 중 내 네 제 새 및 곧 총 큰 긴 후'.split(' '));

function wordSeparator(left: Word, right: Word, lineHeight: number): '' | ' ' {
  if (CLOSING_PUNCTUATION.test(right.text) || OPENING_PUNCTUATION.test(left.text)) return '';
  if (HANGUL_TAIL.test(left.text) && HANGUL_HEAD.test(right.text)
      && right.bbox.x0 - left.bbox.x1 < lineHeight * 0.24) return '';
  return ' ';
}

function isKoreanProse(line: Line) {
  // Keep source and tabular material in physical lines, even when OCR placed it
  // in the same paragraph as the prose around it.
  const text = line.text.trim();
  const hangul = text.match(/[가-힣]/gu)?.length ?? 0;
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  return hangul >= 5 && hangul >= letters * 0.5 && !/^[\s]*[\x60([{]|(?:[{}=;]|\)\s*:)$/.test(text);
}

function lineSeparator(previous: Line, current: Line, proseRight: number, firstWord: string, priorWord: string): PageTextRun['before'] {
  const a = previous.bbox;
  const b = current.bbox;
  const height = Math.max(a.y1 - a.y0, b.y1 - b.y0);
  const verticalDistance = b.y0 - a.y0;
  if (a.x1 - a.x0 < height * 10 || proseRight - a.x1 > height
      || Math.abs(a.x0 - b.x0) > height * 0.55
      || verticalDistance < height * 0.65 || verticalDistance > height * 2.4) return '\n';

  if (!HANGUL_TAIL.test(priorWord) || !HANGUL_HEAD.test(firstWord)) return ' ';
  if (COPULA.test(firstWord)) return undefined;
  // Korean typesetting can wrap inside an eojeol. Only infer a split after a
  // one-syllable fragment before an inflected predicate. Preserve common
  // standalone words and use a space for other uncertain boundaries.
  if (/^[가-힣]$/u.test(priorWord) && !STANDALONE_SYLLABLES.has(priorWord) && PREDICATE.test(firstWord)) return undefined;
  return ' ';
}

function parseLine(line: Line) {
  const height = Math.max(1, line.bbox.y1 - line.bbox.y0);
  const words = line.words.filter(({ text, bbox }) => text.trim() && bbox.x1 > bbox.x0 && bbox.y1 > bbox.y0);
  const separators = words.map((word, index) => index ? wordSeparator(words[index - 1], word, height) : '');
  const firstBoundary = separators.indexOf(' ');
  const lastBoundary = separators.lastIndexOf(' ');
  const firstWord = words.slice(0, firstBoundary < 0 ? undefined : firstBoundary).map((word) => word.text).join('');
  const lastWord = words.slice(lastBoundary < 0 ? 0 : lastBoundary).map((word) => word.text).join('');
  return { line, words, separators, firstWord, lastWord, prose: isKoreanProse(line) };
}

/** Derive clipboard separators from the scan layout. Each OCR box stays independently selectable. */
export function buildOcrRuns(blocks: readonly Block[], scaleX: number, scaleY: number): PageTextRun[] {
  const runs: PageTextRun[] = [];
  for (const block of blocks) {
    for (const paragraph of block.paragraphs) {
      const lines = paragraph.lines.map(parseLine).filter(({ words }) => words.length > 0);
      for (const [index, { line, words, separators, firstWord, prose }] of lines.entries()) {
        const previous = lines[index - 1];
        let lineStart: PageTextRun['before'] = runs.length ? '\n' : undefined;
        if (previous?.prose && prose) {
          const { x0, x1, y0, y1 } = previous.line.bbox;
          const marginTolerance = (y1 - y0) * 0.55;
          const proseRight = lines.reduce((right, { line: candidate, prose: candidateIsProse }) => {
            if (Math.abs(candidate.bbox.x0 - x0) > marginTolerance || !candidateIsProse) return right;
            return Math.max(right, candidate.bbox.x1);
          }, x1);
          lineStart = lineSeparator(previous.line, line, proseRight, firstWord, previous.lastWord);
        }
        for (const [wordIndex, { text, bbox: { x0, y0, x1, y1 } }] of words.entries()) {
          const before = wordIndex ? separators[wordIndex] || undefined : lineStart;
          runs.push({ text, before, x: x0 * scaleX, y: y0 * scaleY,
            width: (x1 - x0) * scaleX, height: (y1 - y0) * scaleY });
        }
      }
    }
  }
  return runs;
}
