export interface BookRef {
  folder: string;
  filename: string;
  size: number;
  modified_at: string;
  tags: string[];
}

export interface TagSummary {
  name: string;
  bookCount: number;
  color: string;
}
import { deleteCachedTag, listCachedBookTags, listCachedFolderTags, listCachedTagSummaries, mutateCachedTag, updateCachedTagColor } from '../cache/metadataCache.js';
import { requestWithMetadataOutbox } from '../cache/metadataOutbox.js';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch('/api' + url, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? '요청 실패');
  return data as T;
}

async function mutate<T>(url: string, options: RequestInit, coalesceKey?: string): Promise<T> {
  const response = await requestWithMetadataOutbox({ coalesceKey, url: '/api' + url, method: options.method ?? 'POST', headers: options.headers as Record<string, string> | undefined, body: options.body as string | undefined });
  const data = await response.json(); if (!response.ok) throw new Error(data.error ?? '요청 실패'); return data as T;
}

export const tagsApi = {
  /** 전체 태그 목록 */
  list: async () => (await listCachedTagSummaries())?.map((row) => row.name) ?? request<string[]>('/tags'),

  /** 태그별 소속 PDF 수 */
  listSummary: async () => (await listCachedTagSummaries()) ?? request<TagSummary[]>('/tags/summary'),

  /** 태그와 해당 태그가 붙은 모든 PDF의 연결을 삭제 */
  delete: async (tag: string) => { await deleteCachedTag(tag); return mutate<{ ok: boolean }>(`/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' }, `tag:delete:${tag}`); },
  updateColor: async (tag: string, color: string) => { await updateCachedTagColor(tag, color); return mutate<{ ok: boolean }>(`/tags/${encodeURIComponent(tag)}/color`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ color }),
    }, `tag:color:${tag}`); },

  /** 특정 태그의 PDF 목록 */
  listBooks: (tag: string) =>
    request<BookRef[]>(`/tags/${encodeURIComponent(tag)}/books`),

  /** 폴더 내 모든 PDF의 태그를 한 번에 조회 → { filename: string[] } */
  listForFolder: async (folder: string) => (await listCachedFolderTags(folder)) ?? request<Record<string, string[]>>(`/tags/folder/${encodeURIComponent(folder)}`),

  /** 특정 PDF의 태그 목록 */
  listForBook: async (folder: string, filename: string) => (await listCachedBookTags(folder, filename)) ?? request<string[]>(
      `/tags/book/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`,
    ),

  /** PDF에 태그 추가 */
  addTag: async (folder: string, filename: string, tag: string) => { await mutateCachedTag(folder, filename, tag, false); return mutate<{ ok: boolean }>(
      `/tags/book/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag }),
      },
      `tag:relation:${folder}:${filename}:${tag}`,
    ); },

  /** PDF에서 태그 제거 */
  removeTag: async (folder: string, filename: string, tag: string) => { await mutateCachedTag(folder, filename, tag, true); return mutate<{ ok: boolean }>(
      `/tags/book/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}/${encodeURIComponent(tag)}`,
      { method: 'DELETE' },
      `tag:relation:${folder}:${filename}:${tag}`,
    ); },
};
