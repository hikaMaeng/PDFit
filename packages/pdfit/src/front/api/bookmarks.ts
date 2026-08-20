import type { BookmarkRecord, CreateBookmarkRequest, UpdateBookmarkRequest } from '../../common/protocol/bookmarks/index.js';
import { cacheBookmarkRecord, deleteCachedBookmark, listCachedBookmarks } from '../cache/metadataCache.js';
import { requestWithMetadataOutbox } from '../cache/metadataOutbox.js';

const path = (folder: string, filename: string) => `/api/bookmarks/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`;

export async function listAllBookmarks(): Promise<BookmarkRecord[]> {
  const cached = await listCachedBookmarks(); if (cached) return cached;
  const response = await fetch('/api/bookmarks');
  if (!response.ok) throw new Error('북마크를 불러오지 못했습니다.');
  return response.json() as Promise<BookmarkRecord[]>;
}

export async function listBookmarks(folder: string, filename: string): Promise<BookmarkRecord[]> {
  const cached = await listCachedBookmarks(folder, filename); if (cached) return cached;
  const response = await fetch(path(folder, filename));
  if (!response.ok) throw new Error('북마크를 불러오지 못했습니다.');
  return response.json() as Promise<BookmarkRecord[]>;
}

export async function createBookmark(folder: string, filename: string, request: CreateBookmarkRequest): Promise<BookmarkRecord> {
  const operationId = request.operationId ?? crypto.randomUUID();
  const response = await requestWithMetadataOutbox({ operationId, url: path(folder, filename), method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...request, operationId }) });
  if (!response.ok) throw new Error('북마크를 저장하지 못했습니다.');
  const record = await response.json() as BookmarkRecord; await cacheBookmarkRecord(record); return record;
}

export async function updateBookmark(id: string, request: UpdateBookmarkRequest): Promise<BookmarkRecord> {
  const response = await requestWithMetadataOutbox({ coalesceKey: `bookmark:update:${id}`, url: `/api/bookmarks/${encodeURIComponent(id)}`, method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  if (!response.ok) throw new Error('북마크를 수정하지 못했습니다.');
  const record = await response.json() as BookmarkRecord; await cacheBookmarkRecord(record); return record;
}

export async function deleteBookmark(id: string): Promise<void> {
  await deleteCachedBookmark(id);
  const response = await requestWithMetadataOutbox({ coalesceKey: `bookmark:delete:${id}`, url: `/api/bookmarks/${encodeURIComponent(id)}`, method: 'DELETE' });
  if (!response.ok) throw new Error('북마크를 삭제하지 못했습니다.');
}
