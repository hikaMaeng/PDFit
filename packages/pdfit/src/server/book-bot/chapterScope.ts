import type { BookOutlineEntry } from '../../common/protocol/outlines/index.js';

const KOREAN_SUMMARY = /^(?:제\s*)?(\d{1,3})\s*장(?:의|을|를)?\s*(?:(?:내용|본문|핵심|요점)(?:을|를)?\s*)?(?:요약|정리)(?:\s*해\s*(?:줘(?:요)?|주세요|주십시오))?[.?!]*$/u;
const ENGLISH_SUMMARY = /^(?:please\s+)?summari[sz]e\s+(?:the (?:contents|text) of\s+)?chapter\s+(\d{1,3})(?:\s+please)?[.?!]*$/i;
const CHAPTER_HEADING = /^[\p{P}\p{S}\s]*(?:(?:제\s*)?(\d{1,3})\s*장|chapter\s+(\d{1,3}))(?![\p{L}\p{N}])/iu;

// See docs/book-bot.md#answer-context. Require two verified page boundaries from the outline.
export function chapterSummaryScope(question: string, outline: BookOutlineEntry[]) {
  const normalized = question.normalize('NFKC').trim();
  const number = Number((KOREAN_SUMMARY.exec(normalized) ?? ENGLISH_SUMMARY.exec(normalized))?.[1]);
  if (!number) return null;
  const roots = outline.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.depth === 0);
  const matches = roots.filter(({ entry }) => {
    const heading = CHAPTER_HEADING.exec(entry.title.normalize('NFKC'));
    return Number(heading?.[1] ?? heading?.[2]) === number;
  });
  if (matches.length !== 1) return null;
  const start = matches[0];
  const end = roots[roots.indexOf(start) + 1];
  if (!start.entry.page || !end?.entry.page || end.entry.page <= start.entry.page) return null;
  return { number, firstPage: start.entry.page, lastPage: end.entry.page - 1, outline: outline.slice(start.index, end.index) };
}
