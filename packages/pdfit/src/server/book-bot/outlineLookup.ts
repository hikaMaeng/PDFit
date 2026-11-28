import type { BookBotBook, BookBotProgress } from '../../common/protocol/book-bot/index.js';
import type { BotPromptMessage } from './promptTokens.js';
import { historyPageRanges, type parseTurnPlan } from './turnPlan.js';
import type { BookBotHistoryPage, BookBotPage, BookBotStore, BookBotStoredTurn } from './types.js';

interface OutlineLookupOptions {
  book: BookBotBook;
  plan: ReturnType<typeof parseTurnPlan>;
  store: BookBotStore;
  activeTurns: BookBotStoredTurn[];
  pageText?: (page: number) => Promise<string | null>;
  onProgress?: (value: BookBotProgress) => void;
  prompt: (evidence: object) => BotPromptMessage[];
  fits: (messages: BotPromptMessage[]) => boolean;
  countMaterial: (entry: object) => number;
}

export async function lookupOutlineMaterial({
  book, plan, store, activeTurns, pageText, onProgress, prompt, fits, countMaterial,
}: OutlineLookupOptions) {
  const previousPages = new Set(activeTurns.flatMap(({ addedPages }) => addedPages?.map(({ page }) => page) ?? []));
  const ranges = [...plan.ranges, ...historyPageRanges(previousPages)];
  if (ranges.length || plan.readerClips || plan.readerComments) onProgress?.({ phase: 'loadingPages' });
  const [ocr, clips, comments] = await Promise.all([
    ranges.length ? store.pages(book, ranges) : [],
    plan.readerClips ? store.clips(book, plan.ranges) : [],
    plan.readerComments ? store.comments(book) : [],
  ]);
  const pages: BookBotPage[] = await Promise.all(ocr.map(async (entry) => ({
    page: entry.page,
    text: entry.text.length >= 63_000 ? (await pageText?.(entry.page)) ?? entry.text : entry.text,
  })));
  // Prioritize the pages selected for this question before pages retained from past turns.
  const orderedPages = new Map<number, BookBotPage>();
  for (const range of plan.ranges) {
    for (const entry of pages) {
      if (entry.page >= range.first && (range.last === null || entry.page <= range.last)) orderedPages.set(entry.page, entry);
    }
  }
  for (const page of pages) orderedPages.set(page.page, page);
  const candidates = [...orderedPages.values()];
  const material = { pages: candidates, clips, comments };
  const materialPrompt = (ocrCount: number, clipCount: number, commentCount: number) =>
    prompt({
      requestedRanges: plan.ranges,
      indexedOcrPages: candidates.length,
      omittedOcrPages: candidates.length - ocrCount,
      omittedClips: clips.length - clipCount,
      omittedComments: comments.length - commentCount,
      pages: material.pages.slice(0, ocrCount),
      clips: material.clips.slice(0, clipCount),
      comments: material.comments.slice(0, commentCount),
    });
  let includedPages = candidates.length;
  let messages = materialPrompt(includedPages, clips.length, comments.length);
  if (!fits(messages)) {
    // Reader-specific material gets first claim on the available budget when explicitly requested.
    let clipCount = clips.length;
    let commentCount = comments.length;
    while (!fits(materialPrompt(0, clipCount, commentCount)) && (clipCount || commentCount)) {
      clipCount = Math.floor(clipCount / 2);
      commentCount = Math.floor(commentCount / 2);
    }
    let low = 0;
    let high = includedPages;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (fits(materialPrompt(middle, clipCount, commentCount))) low = middle;
      else high = middle - 1;
    }
    includedPages = low;
    messages = materialPrompt(includedPages, clipCount, commentCount);
    if (!fits(messages)) throw Object.assign(new Error('The Bot prompt exceeds the configured context limit.'), { code: 'context_limit' });
  }
  const addedPages: BookBotHistoryPage[] = candidates.slice(0, includedPages)
    .filter(({ page }) => !previousPages.has(page))
    .map((entry) => ({ page: entry.page, tokens: countMaterial(entry) }));
  return { messages, addedPages, outlineKeys: plan.outlineKeys };
}
