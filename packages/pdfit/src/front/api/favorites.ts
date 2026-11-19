import { uiText } from '../i18n/uiText.js';
import type { BookRef } from './tags.js';

/** 즐겨찾기 API(`/api/favorites`). 서버는 DB만 읽고 쓰며 로컬 메타데이터 캐시를 거치지 않는다. */
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch('/api/favorites' + url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error((data as { error?: string }).error ?? uiText('요청 실패')) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  return data as T;
}

const path = (folder: string, filename: string) => `/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`;

export const favoritesApi = {
  /** 즐겨찾기한 책의 (folder, filename) 목록 */
  listKeys: () => request<Array<{ folder: string; filename: string }>>(''),
  /** 즐겨찾기한 책의 전체 레코드("즐겨찾기" 보기) */
  listBooks: () => request<BookRef[]>('/books'),
  set: (folder: string, filename: string, favorite: boolean) =>
    request<{ ok: boolean; favorite: boolean }>(path(folder, filename), { method: favorite ? 'PUT' : 'DELETE' }),
};
