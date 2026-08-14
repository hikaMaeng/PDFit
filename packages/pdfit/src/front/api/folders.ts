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

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch('/api' + url, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? '요청 실패');
  return data as T;
}

export const foldersApi = {
  list: () => request<FolderInfo[]>('/folders'),

  refresh: () => request<FolderInfo[]>('/folders/refresh', { method: 'POST' }),

  create: (name: string) =>
    request<{ name: string }>('/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),

  rename: (name: string, newName: string) =>
    request<{ name: string }>(`/folders/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newName }),
    }),

  delete: (name: string) =>
    request<{ ok: boolean }>(`/folders/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  updateColor: (name: string, color: string) =>
    request<{ ok: boolean }>(`/folders/${encodeURIComponent(name)}/color`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ color }),
    }),

  listFiles: (folder: string) =>
    request<PdfInfo[]>(`/folders/${encodeURIComponent(folder)}/files`),

  upload: (folder: string, files: File[], onProgress?: (pct: number) => void, onPhase?: (phase: 'uploading' | 'indexing' | 'refreshing') => void) =>
    new Promise<{ name: string; size: number }[]>((resolve, reject) => {
      const form = new FormData();
      files.forEach((f) => form.append('files', f));
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/folders/${encodeURIComponent(folder)}/files`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 70));
      };
      xhr.onload = () => {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 400) reject(new Error(data.error ?? '업로드 실패'));
        else { onPhase?.('indexing'); onProgress?.(85); resolve(data); }
      };
      xhr.onerror = () => reject(new Error('네트워크 오류'));
      xhr.send(form);
    }),

  deleteFile: (folder: string, filename: string) =>
    request<{ ok: boolean }>(
      `/folders/${encodeURIComponent(folder)}/files/${encodeURIComponent(filename)}`,
      { method: 'DELETE' },
    ),

  moveFile: (fromFolder: string, toFolder: string, filename: string) =>
    request<{ ok: boolean }>('/folders/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromFolder, toFolder, filename }),
    }),

  fileUrl: (folder: string, filename: string) =>
    `/api/folders/${encodeURIComponent(folder)}/files/${encodeURIComponent(filename)}`,
};
