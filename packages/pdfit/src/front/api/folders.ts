export interface FolderInfo {
  name: string;
  pdfCount: number;
  createdAt: string;
  isRoot: boolean;
  color: string;
}

export interface PdfInfo {
  name: string;
  size: number;
  modifiedAt: string;
}

import { invalidatePdfitMetadataCache, listCachedFiles, listCachedFolders } from '../cache/metadataCache.js';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch('/api' + url, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? '요청 실패');
  return data as T;
}

export const foldersApi = {
  list: async () => (await listCachedFolders()) ?? request<FolderInfo[]>('/folders'),

  refresh: async () => {
    await request<FolderInfo[]>('/folders/refresh', { method: 'POST' });
    await invalidatePdfitMetadataCache();
    return (await listCachedFolders()) ?? request<FolderInfo[]>('/folders');
  },

  create: async (name: string) => {
    const result = await request<{ name: string }>('/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    await invalidatePdfitMetadataCache();
    return result;
  },

  rename: async (name: string, newName: string) => {
    const result = await request<{ name: string }>(`/folders/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newName }),
    });
    await invalidatePdfitMetadataCache();
    return result;
  },

  delete: async (name: string) => {
    const result = await request<{ ok: boolean }>(`/folders/${encodeURIComponent(name)}`, { method: 'DELETE' });
    await invalidatePdfitMetadataCache();
    return result;
  },

  updateColor: async (name: string, color: string) => {
    const result = await request<{ ok: boolean }>(`/folders/${encodeURIComponent(name)}/color`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ color }),
    });
    await invalidatePdfitMetadataCache();
    return result;
  },

  listFiles: async (folder: string) => (await listCachedFiles(folder)) ?? request<PdfInfo[]>(`/folders/${encodeURIComponent(folder)}/files`),

  upload: (folder: string, files: File[], onProgress?: (pct: number) => void, onPhase?: (phase: 'uploading' | 'indexing' | 'refreshing') => void) =>
    new Promise<{ name: string; size: number }[]>((resolve, reject) => {
      const form = new FormData();
      files.forEach((f) => form.append('files', f));
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/folders/${encodeURIComponent(folder)}/files`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 70));
      };
      xhr.onload = async () => {
        let data: { error?: string } & { name: string; size: number }[];
        try {
          data = JSON.parse(xhr.responseText) as typeof data;
        } catch {
          reject(new Error(`업로드 실패 (HTTP ${xhr.status})`));
          return;
        }
        if (xhr.status >= 400) reject(new Error(data.error ?? '업로드 실패'));
        else { onPhase?.('indexing'); onProgress?.(85); await invalidatePdfitMetadataCache(); resolve(data as { name: string; size: number }[]); }
      };
      xhr.onerror = () => reject(new Error('네트워크 오류'));
      xhr.send(form);
    }),

  deleteFile: async (folder: string, filename: string) => {
    const result = await request<{ ok: boolean }>(
      `/folders/${encodeURIComponent(folder)}/files/${encodeURIComponent(filename)}`,
      { method: 'DELETE' },
    );
    await invalidatePdfitMetadataCache();
    return result;
  },

  moveFile: async (fromFolder: string, toFolder: string, filename: string) => {
    const result = await request<{ ok: boolean }>('/folders/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromFolder, toFolder, filename }),
    });
    await invalidatePdfitMetadataCache();
    return result;
  },

  fileUrl: (folder: string, filename: string) =>
    `/api/folders/${encodeURIComponent(folder)}/files/${encodeURIComponent(filename)}`,
};
