export const CONTENT_SEARCH_SCOPES = ['outline', 'page-ocr', 'clip-ocr', 'clip-memo'] as const;
export type ContentSearchScope = typeof CONTENT_SEARCH_SCOPES[number];

export function isContentSearchScope(value: unknown): value is ContentSearchScope {
  return CONTENT_SEARCH_SCOPES.some((scope) => scope === value);
}

export interface ContentSearchHit {
  /** Outline key, page number, or clip UUID. Unique within a book and scope. */
  id: string;
  folder: string;
  filename: string;
  page: number | null;
  snippet: string;
}

export interface ContentSearchResult {
  hits: ContentSearchHit[];
  hasMore: boolean;
}
