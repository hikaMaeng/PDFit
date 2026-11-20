import { uiText } from '../i18n/uiText.js';

/** 태그 폴더 API(`/api/tag-folders`). 서버 DB만 읽고 쓰며 로컬 메타데이터 캐시를 거치지 않는다. */
export interface TagFolder {
  name: string;
  tags: string[];
}

export type TagFolderError = Error & { status?: number };

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch('/api/tag-folders' + url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error((data as { error?: string }).error ?? uiText('요청 실패')) as TagFolderError;
    error.status = res.status;
    throw error;
  }
  return data as T;
}

const tagPath = (folder: string, tag: string) => `/${encodeURIComponent(folder)}/tags/${encodeURIComponent(tag)}`;

export const tagFoldersApi = {
  list: () => request<TagFolder[]>(''),
  create: (name: string) => request<{ ok: boolean; name: string }>('', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  }),
  remove: (name: string) => request<{ ok: boolean }>(`/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  addTag: (folder: string, tag: string) => request<{ ok: boolean }>(tagPath(folder, tag), { method: 'PUT' }),
  removeTag: (folder: string, tag: string) => request<{ ok: boolean }>(tagPath(folder, tag), { method: 'DELETE' }),
};
