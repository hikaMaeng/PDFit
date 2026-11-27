import { uiText } from '../i18n/uiText.js';
import { AI_MODEL_PROGRESS_MEDIA_TYPE, type AiModelProgress } from '../../common/protocol/ai-model/index.js';
import { readAiProgressResponse } from './aiProgress.js';
import type { TagIndexEntry, TagSummary } from '../../shared/index.js';
import type { TagDetails, TagDetailsPatch } from '../../shared/tagDetails.js';
export type { TagIndexEntry, TagSummary } from '../../shared/index.js';
export interface BookRef extends Partial<import('../../common/protocol/bookmarks/index.js').BookClipCount> {
  folder: string;
  filename: string;
  driveFileId?: string;
  size: number;
  modified_at: string;
  tags: string[];
}

export interface AutomaticTagResult {
  title: string;
  suggestedTags: string[];
  addedTags: string[];
  removedTags: string[];
}
import { deleteAllCachedTags, deleteCachedFolderTags, deleteCachedTag, listCachedBooksByTag, listCachedTagIndex, listCachedUntaggedBooks, listCachedBookTags, listCachedFolderTags, listCachedTagSummaries, mutateCachedTag, pdfitMetadataScope, restoreCachedTag, updateCachedTagColor } from '../cache/metadataCache.js';
import { requestWithMetadataOutbox } from '../cache/metadataOutbox.js';
import { recentTagsForScope } from '../model/recentTags.js';

async function request<T>(url: string, options?: RequestInit, onModelProgress?: (phase: AiModelProgress) => void): Promise<T> {
  const res = await readAiProgressResponse(await fetch('/api' + url, options), onModelProgress);
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error ?? uiText("요청 실패")), { status: res.status });
  return data as T;
}

async function mutate<T>(url: string, options: RequestInit, coalesceKey?: string): Promise<T> {
  const response = await requestWithMetadataOutbox({ coalesceKey, url: '/api' + url, method: options.method ?? 'POST', headers: options.headers as Record<string, string> | undefined, body: options.body as string | undefined });
  const data = await response.json(); if (!response.ok) throw new Error(data.error ?? uiText("요청 실패")); return data as T;
}

export const tagsApi = {
  /** 전체 태그 목록 */
  list: async () => (await listCachedTagSummaries())?.map((row) => row.name) ?? request<string[]>('/tags'),

  /** 태그별 소속 PDF 수 */
  listSummary: async (): Promise<TagSummary[]> => (await listCachedTagSummaries()) ?? request<TagSummary[]>('/tags/summary'),

  /** 태그와 해당 태그가 붙은 모든 PDF의 연결을 삭제 */
  delete: async (tag: string) => {
    await deleteCachedTag(tag);
    try {
      return await mutate<{ ok: boolean }>(`/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' }, `tag:delete:${tag}`);
    } catch (error) {
      await restoreCachedTag(tag).catch(() => undefined);
      throw error;
    }
  },
  deleteAll: async () => {
    const result = await mutate<{ ok: boolean }>('/tags', { method: 'DELETE' }, 'tag:delete-all');
    await deleteAllCachedTags();
    return result;
  },
  updateColor: async (tag: string, color: string, previousColor?: string) => {
    await updateCachedTagColor(tag, color);
    try {
      return await mutate<{ ok: boolean }>(`/tags/${encodeURIComponent(tag)}/color`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ color }),
      }, `tag:color:${tag}`);
    } catch (error) {
      if (previousColor) await updateCachedTagColor(tag, previousColor).catch(() => undefined);
      throw error;
    }
  },
  updateDetails: (id: string, patch: TagDetailsPatch) => request<TagDetails>(`/tags/${encodeURIComponent(id)}/details`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  }),

  /** 특정 태그의 PDF 목록 */
  listBooks: async (tag: string) =>
    (await listCachedBooksByTag(tag)) ?? request<BookRef[]>(`/tags/${encodeURIComponent(tag)}/books`),

  /** 모든 태그와 각 태그의 책을 한 번에("인덱스" 페이지). 서버는 `GET /api/tags/index`, 하이드레이트된 캐시가 있으면 로컬 투영. */
  listIndex: async () =>
    (await listCachedTagIndex()) ?? request<TagIndexEntry[]>('/tags/index'),

  /** 태그가 하나도 없는 PDF 목록("미분류") */
  listUntaggedBooks: async () =>
    (await listCachedUntaggedBooks()) ?? request<BookRef[]>('/tags/untagged-books'),

  /** 태그가 하나도 없는 PDF 수(사이드바 배지) */
  countUntaggedBooks: async () => {
    const cached = await listCachedUntaggedBooks();
    if (cached) return cached.length;
    const { count } = await request<{ count: number }>('/tags/untagged-count');
    return Number.isFinite(count) ? count : 0;
  },

  /** 폴더 내 모든 PDF의 태그를 한 번에 조회 → { filename: string[] } */
  listForFolder: async (folder: string) => (await listCachedFolderTags(folder)) ?? request<Record<string, string[]>>(`/tags/folder/${encodeURIComponent(folder)}`),

  /** 특정 PDF의 태그 목록 */
  listForBook: async (folder: string, filename: string, driveFileId?: string | null) => (await listCachedBookTags(folder, filename, driveFileId)) ?? request<string[]>(
      `/tags/book/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}${driveFileId ? `?driveFileId=${encodeURIComponent(driveFileId)}` : ''}`,
    ),

  /** PDF에 태그 추가 */
  addTag: async (folder: string, filename: string, tag: string, driveFileId?: string | null) => {
    const history = recentTagsForScope(pdfitMetadataScope());
    await mutateCachedTag(folder, filename, tag, false, driveFileId);
    const result = await mutate<{ ok: boolean }>(
      `/tags/book/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag, ...(driveFileId ? { driveFileId } : {}) }),
      },
      `tag:relation:${folder}:${filename}:${tag}`,
    );
    if (result.ok) history.record(tag);
    return result;
  },

  /** 책 제목을 AI로 분류하고 추천 태그를 서버에서 바로 저장 */
  autoTag: async (folder: string, filename: string, driveFileId?: string | null, onModelProgress?: (phase: AiModelProgress) => void) => {
    const result = await request<AutomaticTagResult>(
      `/tags/book/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}/auto`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: AI_MODEL_PROGRESS_MEDIA_TYPE },
        body: JSON.stringify(driveFileId ? { driveFileId } : {}),
      },
      onModelProgress,
    );
    await Promise.all(result.addedTags.map((tag) => mutateCachedTag(folder, filename, tag, false, driveFileId)));
    await Promise.all(result.removedTags.map((tag) => mutateCachedTag(folder, filename, tag, true, driveFileId)));
    return result;
  },

  clearFolderTags: async (folder: string) => {
    const result = await mutate<{ ok: boolean; removed: number }>(
      `/tags/folder/${encodeURIComponent(folder)}`,
      { method: 'DELETE' },
      `tag:folder:clear:${folder}`,
    );
    await deleteCachedFolderTags(folder);
    return result;
  },

  /** PDF에서 태그 제거 */
  removeTag: async (folder: string, filename: string, tag: string, driveFileId?: string | null) => { await mutateCachedTag(folder, filename, tag, true, driveFileId); return mutate<{ ok: boolean }>(
      `/tags/book/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}/${encodeURIComponent(tag)}${driveFileId ? `?driveFileId=${encodeURIComponent(driveFileId)}` : ''}`,
      { method: 'DELETE' },
      `tag:relation:${folder}:${filename}:${tag}`,
    ); },

  /** 네트워크 변경 실패 시 로컬 태그 관계만 원상 복구 */
  restoreCachedRelation: (folder: string, filename: string, tag: string, present: boolean, driveFileId?: string | null) =>
    mutateCachedTag(folder, filename, tag, !present, driveFileId),
};
