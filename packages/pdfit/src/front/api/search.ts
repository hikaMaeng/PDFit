import { uiText } from '../i18n/uiText.js';
import { searchCachedBooksByTitle } from '../cache/metadataCache.js';
import type { BookRef } from './tags.js';

export interface BookSearchResult {
  query: string;
  /** 일치한 전체 권수. `books`는 서버 상한(기본 500)에서 잘릴 수 있다. */
  total: number;
  books: BookRef[];
}

export const searchApi = {
  /**
   * 책 제목 부분 문자열 검색. Pro는 하이드레이트된 브라우저 메타데이터 DB, 로컬 런타임은 서버 PostgreSQL을 조회한다.
   * 파일 시스템은 조회하지 않는다.
   */
  booksByTitle: async (query: string): Promise<BookSearchResult> => {
    const trimmed = query.trim();
    if (!trimmed) return { query: '', total: 0, books: [] };
    const cached = await searchCachedBooksByTitle(trimmed);
    if (cached) return { query: trimmed, total: cached.total, books: cached.books };
    const response = await fetch(`/api/search/books?q=${encodeURIComponent(trimmed)}`);
    const data = await response.json().catch(() => ({})) as Partial<BookSearchResult> & { error?: string };
    if (!response.ok) throw new Error(data.error ?? uiText("요청 실패"));
    return { query: trimmed, total: data.total ?? 0, books: data.books ?? [] };
  },
};
