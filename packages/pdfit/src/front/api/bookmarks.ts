import type { BookmarkRecord, CreateBookmarkRequest, UpdateBookmarkRequest } from '../../common/protocol/bookmarks/index.js';

const path = (folder: string, filename: string) => `/api/bookmarks/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`;

export async function listAllBookmarks(): Promise<BookmarkRecord[]> {
  const response = await fetch('/api/bookmarks');
  if (!response.ok) throw new Error('북마크를 불러오지 못했습니다.');
  return response.json() as Promise<BookmarkRecord[]>;
}

export async function listBookmarks(folder: string, filename: string): Promise<BookmarkRecord[]> {
  const response = await fetch(path(folder, filename));
  if (!response.ok) throw new Error('북마크를 불러오지 못했습니다.');
  return response.json() as Promise<BookmarkRecord[]>;
}

export async function createBookmark(folder: string, filename: string, request: CreateBookmarkRequest): Promise<BookmarkRecord> {
  const response = await fetch(path(folder, filename), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  if (!response.ok) throw new Error('북마크를 저장하지 못했습니다.');
  return response.json() as Promise<BookmarkRecord>;
}

export async function updateBookmark(id: string, request: UpdateBookmarkRequest): Promise<BookmarkRecord> {
  const response = await fetch(`/api/bookmarks/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  if (!response.ok) throw new Error('북마크를 수정하지 못했습니다.');
  return response.json() as Promise<BookmarkRecord>;
}

export async function deleteBookmark(id: string): Promise<void> {
  const response = await fetch(`/api/bookmarks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('북마크를 삭제하지 못했습니다.');
}
