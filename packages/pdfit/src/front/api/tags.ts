import { uiText } from '../i18n/uiText.js';
export interface BookRef {
  folder: string;
  filename: string;
  driveFileId?: string;
  size: number;
  modified_at: string;
  tags: string[];
}

export interface TagSummary {
  name: string;
  bookCount: number;
  color: string;
}

/** 인덱스 카드 한 장: 태그와 그 태그가 붙은 모든 책. */
export interface TagIndexEntry {
  name: string;
  color: string;
  books: Array<{ folder: string; filename: string; driveFileId?: string }>;
}

export interface AutomaticTagResult {
  title: string;
  suggestedTags: string[];
  addedTags: string[];
  removedTags: string[];
}
export interface AutomaticFolderTagResult {
  processed: number;
  failed: number;
  addedTags: number;
  cancelled?: boolean;
  books: Array<{ filename: string; driveFileId?: string; assignedTag?: string; addedTags: string[]; removedTags: string[] }>;
  errors: Array<{ filename: string; driveFileId?: string; error: string }>;
}
import { deleteAllCachedTags, deleteCachedFolderTags, deleteCachedTag, listCachedBooksByTag, listCachedTagIndex, listCachedUntaggedBooks, listCachedBookTags, listCachedFolderTags, listCachedTagSummaries, mutateCachedTag, restoreCachedTag, updateCachedTagColor } from '../cache/metadataCache.js';
import { requestWithMetadataOutbox } from '../cache/metadataOutbox.js';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch('/api' + url, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? uiText("요청 실패"));
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
  listSummary: async () => (await listCachedTagSummaries()) ?? request<TagSummary[]>('/tags/summary'),

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
  addTag: async (folder: string, filename: string, tag: string, driveFileId?: string | null) => { await mutateCachedTag(folder, filename, tag, false, driveFileId); return mutate<{ ok: boolean }>(
      `/tags/book/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag, ...(driveFileId ? { driveFileId } : {}) }),
      },
      `tag:relation:${folder}:${filename}:${tag}`,
    ); },

  /** 책 제목을 AI로 분류하고 추천 태그를 서버에서 바로 저장 */
  autoTag: async (folder: string, filename: string, driveFileId?: string | null) => {
    const result = await request<AutomaticTagResult>(
      `/tags/book/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}/auto`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(driveFileId ? { driveFileId } : {}),
      },
    );
    await Promise.all(result.addedTags.map((tag) => mutateCachedTag(folder, filename, tag, false, driveFileId)));
    await Promise.all(result.removedTags.map((tag) => mutateCachedTag(folder, filename, tag, true, driveFileId)));
    return result;
  },

  /** 폴더의 PDF 제목을 분류하고 태그 관계를 서버에서 한 번에 저장 */
  autoTagFolder: async (
    folder: string,
    books: Array<{ filename: string; driveFileId?: string | null }>,
    onProgress?: (completed: number, total: number) => void,
    isCancelled: () => boolean = () => false,
  ) => {
    const keyFor = (book: { filename: string; driveFileId?: string | null }) => `${book.driveFileId ?? ''}\0${book.filename}`;
    const resultBooks = new Map<string, AutomaticFolderTagResult['books'][number]>();
    const failures = new Map<string, AutomaticFolderTagResult['errors'][number]>();
    const batchSize = 6;
    let completed = 0;

    const classify = async (batch: typeof books, countProgress: boolean) => {
      try {
        const result = await request<AutomaticFolderTagResult>(
          `/tags/folder/${encodeURIComponent(folder)}/auto`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ books: batch.map((book) => ({ filename: book.filename, ...(book.driveFileId ? { driveFileId: book.driveFileId } : {}) })) }),
          },
        );
        for (const book of result.books) {
          const key = keyFor(book);
          resultBooks.set(key, book);
          failures.delete(key);
          const assignedTag = book.assignedTag ?? book.addedTags[0];
          if (assignedTag) await mutateCachedTag(folder, book.filename, assignedTag, false, book.driveFileId);
          await Promise.all(book.removedTags.map((tag) => mutateCachedTag(folder, book.filename, tag, true, book.driveFileId)));
        }
        for (const error of result.errors) failures.set(keyFor(error), error);
      } catch (cause) {
        const error = cause instanceof Error ? cause.message : uiText("일괄 태그 요청 실패");
        for (const book of batch) failures.set(keyFor(book), { filename: book.filename, ...(book.driveFileId ? { driveFileId: book.driveFileId } : {}), error });
      } finally {
        if (countProgress) { completed += batch.length; onProgress?.(Math.min(completed, books.length), books.length); }
      }
    };

    for (let index = 0; index < books.length; index += batchSize) {
      if (isCancelled()) break;
      await classify(books.slice(index, index + batchSize), true);
    }
    const retryTargets = [...failures.keys()].map((key) => books.find((book) => keyFor(book) === key)).filter((book): book is typeof books[number] => Boolean(book));
    // A failed item is retried through the single-book route instead of being
    // placed in another batch. This isolates title classification, metadata
    // repair, persistence, and cache reconciliation from every other PDF.
    for (const book of retryTargets) {
      if (isCancelled()) break;
      const key = keyFor(book);
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        if (isCancelled()) break;
        try {
          const result = await request<AutomaticTagResult>(
            `/tags/book/${encodeURIComponent(folder)}/${encodeURIComponent(book.filename)}/auto`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(book.driveFileId ? { driveFileId: book.driveFileId } : {}),
            },
          );
          const assignedTag = result.suggestedTags[0] ?? result.addedTags[0];
          if (!assignedTag) throw new Error(uiText("신뢰할 수 있는 도서 분류를 결정하지 못했습니다."));
          await mutateCachedTag(folder, book.filename, assignedTag, false, book.driveFileId);
          await Promise.all(result.removedTags.map((tag) => mutateCachedTag(folder, book.filename, tag, true, book.driveFileId)));
          resultBooks.set(key, {
            filename: book.filename,
            ...(book.driveFileId ? { driveFileId: book.driveFileId } : {}),
            assignedTag,
            addedTags: result.addedTags,
            removedTags: result.removedTags,
          });
          failures.delete(key);
          break;
        } catch (cause) {
          failures.set(key, {
            filename: book.filename,
            ...(book.driveFileId ? { driveFileId: book.driveFileId } : {}),
            error: cause instanceof Error ? cause.message : uiText("개별 태그 재시도 실패 ({p0}/3)", { p0: attempt }),
          });
        }
      }
    }

    const resolved = [...resultBooks.values()];
    return {
      processed: resolved.length,
      failed: failures.size,
      addedTags: resolved.reduce((total, book) => total + book.addedTags.length, 0),
      cancelled: isCancelled(),
      books: resolved,
      errors: [...failures.values()],
    } satisfies AutomaticFolderTagResult;
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
