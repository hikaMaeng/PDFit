import { BOOK_OUTLINE_MAX_ENTRIES, BOOK_OUTLINE_MAX_TITLE_LENGTH, type BookOutlineEntry } from '../../common/protocol/outlines/index.js';

export interface BookstoreContents {
  title: string;
  contents: string;
}

export type BookstoreOutlineLookup = (isbn?: string, signal?: AbortSignal) => Promise<BookstoreContents | null>;

interface TextItem { str: string; transform: number[]; width: number }
interface OutlinePage {
  getViewport(options: { scale: number }): { width: number; height: number; convertToViewportPoint(x: number, y: number): number[] };
  getTextContent(): Promise<{ items: Array<TextItem | { type: string }> }>;
}

export interface OutlinePageSource {
  numPages: number;
  getPage(page: number): Promise<OutlinePage>;
  getPageLabels(): Promise<string[] | null>;
}

interface PageText {
  lines: string[];
  headings: string[];
  footer: number | null;
}

interface ContentsRow {
  title: string;
  depth: number;
  printed: string | null;
  index: string;
}

const INDEX = /^(\d{1,3}(?:\s*[.,]\s*\d{1,3})+)\.?\s*(?=\D|$)/;
const CHAPTER = /^(?:chapter\s+\d+\b|제?\s*\d+\s*장(?=\s|[:|.]))/i;
const PART = /^(?:part\s+\d+\b|제?\s*\d+\s*부(?=\s|[:|.]))/i;
const APPENDIX = /^(?:부록|appendix)\s*[a-z]\b/i;
const PAGE_SUFFIX = /\s+(\d{1,4}|[ivxlcdm]{1,7})$/i;
const BARE_CONTAINER = /^(?:part|chapter)\s+\d+$/i;

function compact(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function headingIndex(text: string): string {
  return (INDEX.exec(text.replace(/^[\s_•·]+/, ''))?.[1] ?? '').replace(/\s/g, '').replace(/,/g, '.');
}

function readContents(book: BookstoreContents): ContentsRow[] {
  const lines = book.contents.split('\n')
    .map((line) => line.normalize('NFKC').replace(/^[\s_•·]+/, '').trim())
    .filter((line) => line && compact(line) !== compact(book.title) && !/^(?:목차|차례|table of contents)$/i.test(line))
    .slice(0, BOOK_OUTLINE_MAX_ENTRIES);
  const numbers = lines.flatMap((line) => {
    const number = PAGE_SUFFIX.exec(line)?.[1];
    return number && /^\d+$/.test(number) && !BARE_CONTAINER.test(line) ? [Number(number)] : [];
  });
  const numbered = numbers.length >= 3 && numbers.length >= lines.length / 2
    && numbers.slice(1).filter((page, i) => page >= numbers[i]).length >= (numbers.length - 1) * 0.9;
  let chapterLevel = 0;
  let appendix = false;
  return lines.map((line) => {
    const footer = numbered && !BARE_CONTAINER.test(line)
      ? PAGE_SUFFIX.exec(line) : /[.·…]{3,}\s*(\d{1,4}|[ivxlcdm]{1,7})$/i.exec(line);
    const title = (footer ? line.slice(0, footer.index) : line).replace(/[\s.·…]+$/, '').slice(0, BOOK_OUTLINE_MAX_TITLE_LENGTH);
    const index = headingIndex(title);
    let depth = 0;
    if (PART.test(title)) chapterLevel = 1;
    else if (CHAPTER.test(title)) depth = chapterLevel;
    else if (index) depth = chapterLevel + index.split('.').length - 1;
    else if (/^(?:부록|appendix)$/i.test(title)) appendix = true;
    else if (appendix && APPENDIX.test(title)) depth = 1;
    return { title, depth: Math.min(depth, 31), printed: footer?.[1]?.toLowerCase() ?? null, index };
  }).filter(({ title }) => /\p{L}/u.test(title));
}

async function readPage(source: OutlinePageSource, pageNumber: number): Promise<PageText> {
  const page = await source.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const { items } = await page.getTextContent();
  const boxes = items.flatMap((item) => {
    if (!('str' in item) || !item.str.trim()) return [];
    const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
    return [{ text: item.str.trim(), x: x / viewport.width, y: y / viewport.height }];
  }).sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: Array<{ y: number; boxes: typeof boxes }> = [];
  for (const box of boxes) {
    const row = rows.at(-1);
    if (row && box.y - row.y <= 0.004) row.boxes.push(box);
    else rows.push({ y: box.y, boxes: [box] });
  }
  const lines = rows.map((row) => ({
    y: row.y,
    text: row.boxes.sort((a, b) => a.x - b.x).map(({ text }) => text).join(' ').normalize('NFKC'),
  }));
  const footers = lines.filter(({ y }) => y >= 0.88 && y <= 0.99).flatMap(({ text }) => {
    const number = /^(\d{1,4})(?:$|\s+CHAPTER\s+\d+\b)/i.exec(text);
    return number ? [Number(number[1])] : [];
  });
  const headings = lines.filter(({ y, text }) => y >= 0.03 && y <= 0.42 && text.length <= 170);
  return {
    lines: lines.map(({ text }) => text),
    headings: headings.flatMap(({ y, text }, i) => {
      const next = headings[i + 1];
      return next && next.y - y < 0.045 && !headingIndex(next.text) ? [text, `${text} ${next.text}`] : [text];
    }),
    footer: footers.length === 1 ? footers[0] : null,
  };
}

function validIsbn(input: string): boolean {
  return input.length === 13 && [...input].reduce((sum, digit, i) => sum + Number(digit) * (i % 2 ? 3 : 1), 0) % 10 === 0;
}

function titleSimilarity(expected: string, found: string): number {
  if (expected === found) return 1;
  if (Math.min(expected.length, found.length) < 6) return 0;
  if (found.startsWith(expected)) return 0.95;
  const pairs = new Set(Array.from({ length: expected.length - 1 }, (_, i) => expected.slice(i, i + 2)));
  const foundPairs = new Set(Array.from({ length: found.length - 1 }, (_, i) => found.slice(i, i + 2)));
  let overlap = 0;
  for (const pair of foundPairs) if (pairs.has(pair)) overlap += 1;
  return 2 * overlap / (pairs.size + foundPairs.size);
}

/** A numeric footnote only becomes a page anchor if that offset is repeated across the document. */
function printedPageNumbers(pages: Map<number, PageText>): Map<number, number[]> {
  const anchors = [...pages].flatMap(([page, { footer }]) => footer && Math.abs(page - footer) <= 100 ? [{ page, footer, offset: page - footer }] : []);
  const counts = new Map<number, number>();
  for (const { offset } of anchors) counts.set(offset, (counts.get(offset) ?? 0) + 1);
  const printed = new Map<number, number[]>();
  for (const { page, footer, offset } of anchors.sort((a, b) => a.page - b.page)) {
    if ((counts.get(offset) ?? 0) >= 3) {
      const matches = printed.get(footer);
      if (matches) matches.push(page);
      else printed.set(footer, [page]);
    }
  }
  return printed;
}

function resolvePrintedPage(printed: string | null, anchors: Map<number, number[]>, pages: Map<number, PageText>): number | null {
  if (!printed) return null;
  const number = Number(printed);
  if (!Number.isInteger(number)) return null;
  const direct = anchors.get(number);
  if (direct) return direct.length === 1 ? direct[0] : null;
  if (number > Math.max(0, ...anchors.keys())) return null;
  const nearby = [...anchors].filter(([footer]) => Math.abs(footer - number) <= 8)
    .sort(([a], [b]) => Math.abs(a - number) - Math.abs(b - number));
  const offsets = new Set(nearby.slice(0, 3).flatMap(([footer, knownPages]) => knownPages.map((page) => page - footer)));
  const guesses = [...offsets].map((offset) => number + offset)
    .filter((guess) => pages.has(guess) && (pages.get(guess)?.footer ?? number) === number);
  return guesses.length === 1 ? guesses[0] : null;
}

function pageLabelIndex(labels: string[] | null, anchors: Map<number, number[]>): Map<string, number> {
  const matches = new Map<string, number>();
  const duplicates = new Set<string>();
  const unreliableNumbers = [...anchors].some(([printed, pages]) => pages.some((page) => labels?.[page - 1]?.trim() !== String(printed)));
  labels?.forEach((value, i) => {
    const label = value.trim().toLowerCase();
    if (!label || (unreliableNumbers && /^\d+$/.test(label))) return;
    if (matches.has(label)) duplicates.add(label);
    matches.set(label, i + 1);
  });
  for (const label of duplicates) matches.delete(label);
  return matches;
}

function matchHeadings(rows: ContentsRow[], pages: Map<number, PageText>): Array<number | null> {
  const matches = rows.map(() => [] as Array<{ page: number; score: number }>);
  const expected = rows.map(({ title }) => compact(title));
  const sectionIndexes = new Set(rows.filter(({ index }) => index).map(({ index }) => index));
  const frontMatterLimit = Math.min(32, Math.max(4, Math.ceil(pages.size / 4)));
  for (const [page, { headings, lines }] of pages) {
    // Published contents have many listed headings spread down the page, below the body
    // heading search area. Exclude them up front to resolve the real first occurrence.
    if (page <= frontMatterLimit) {
      const indices = new Set(lines.map(headingIndex).filter((index) => sectionIndexes.has(index)));
      if (indices.size >= 4) continue;
    }
    const candidates = headings.map((heading) => ({ text: compact(heading), index: headingIndex(heading) }));
    const hits = rows.flatMap((row, i) => {
      let score = 0;
      for (const candidate of candidates) {
        if (row.index && candidate.index !== row.index) continue;
        score = Math.max(score, titleSimilarity(expected[i], candidate.text));
      }
      return score >= (row.index ? 0.65 : 0.84) ? [{ i, page, score }] : [];
    });
    // A printed contents page repeats many adjacent headings together, before the body starts.
    if (page <= frontMatterLimit && hits.length >= 4) continue;
    for (const { i, ...match } of hits) matches[i].push(match);
  }
  let previous = 0;
  return matches.map((hits) => {
    const hit = hits.filter(({ page }) => page >= previous).sort((a, b) => b.score - a.score || a.page - b.page)[0];
    if (hit) previous = hit.page;
    return hit?.page ?? null;
  });
}

export async function readBookstoreOutline(source: OutlinePageSource, lookup: BookstoreOutlineLookup, signal?: AbortSignal): Promise<BookOutlineEntry[] | null> {
  const pages = new Map<number, PageText>();
  const readPages = async (numbers: number[]) => {
    for (let start = 0; start < numbers.length; start += 8) {
      signal?.throwIfAborted();
      await Promise.all(numbers.slice(start, start + 8).map(async (number) => {
        const page = await readPage(source, number).catch(() => null);
        if (page) pages.set(number, page);
      }));
    }
  };
  const identityPages = [...new Set([1, 2, 3, source.numPages - 1, source.numPages])].filter((page) => page >= 1 && page <= source.numPages);
  await readPages(identityPages);
  const detectedIsbns = identityPages.flatMap((page) => pages.get(page)?.lines ?? [])
    .flatMap((line) => [...line.matchAll(/\bISBN\b[^\d]*?(97[89](?:[\s-]*\d){10})(?!\d)/gi)].map((match) => match[1].replace(/[^\d]/g, '')))
    .filter(validIsbn);
  const candidates = [...new Set(detectedIsbns)].slice(0, 2);
  let book: BookstoreContents | null = null;
  for (const isbn of candidates) {
    signal?.throwIfAborted();
    book = await lookup(isbn, signal);
    if (book) break;
  }
  signal?.throwIfAborted();
  if (candidates.length === 0) book = await lookup(undefined, signal);
  if (!book) return null;
  signal?.throwIfAborted();
  const rows = readContents(book);
  if (!rows.length) return null;
  const labels = await source.getPageLabels().catch(() => null);
  const remaining = Array.from({ length: Math.min(source.numPages, 600) }, (_, i) => i + 1).filter((page) => !pages.has(page));
  await readPages(remaining);
  signal?.throwIfAborted();
  const anchors = printedPageNumbers(pages);
  const labelIndex = pageLabelIndex(labels, anchors);
  const headingPages = matchHeadings(rows, pages);
  const entries = rows.map((row, i): BookOutlineEntry => ({
    key: String(i), title: row.title, depth: row.depth,
    page: resolvePrintedPage(row.printed, anchors, pages) ?? headingPages[i] ?? labelIndex.get(row.printed ?? '') ?? null,
  }));
  // A section heading confirms where an unnumbered container starts. Use only its own descendants.
  for (let i = entries.length - 2; i >= 0; i -= 1) {
    const entry = entries[i];
    const child = entries[i + 1];
    if (entry.page === null && rows[i].printed === null && child.depth > entry.depth) entry.page = child.page;
  }
  return entries;
}
