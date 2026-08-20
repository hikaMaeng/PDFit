export interface FolderInfo {
  name: string;
  pdfCount: number;
  createdAt: string;
  isRoot: boolean;
  color: string;
  driveFolderId?: string;
  parentFolderId?: string;
}

export interface PdfInfo {
  name: string;
  size: number;
  modifiedAt: string;
  driveFileId?: string;
}

import { deleteCachedFile, deleteCachedFolder, invalidatePdfitMetadataCache, listCachedFiles, listCachedFolders, moveCachedFile, updateCachedFolderColor, upsertCachedFile, upsertCachedFolder } from '../cache/metadataCache.js';
import { isPdfFile, ResumableSessionExpiredError, uploadPdfToResumableSession } from '../upload/resumableUpload.js';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch('/api' + url, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? '요청 실패');
  return data as T;
}

interface ResumableSession { driveFileId: string; sessionUrl: string; expiresAt: string }

async function directUpload(folder: string, files: File[], onProgress?: (pct: number) => void, onPhase?: (phase: 'uploading' | 'indexing' | 'refreshing') => void): Promise<PdfInfo[] | null> {
  if (!(await Promise.all(files.map(isPdfFile))).every(Boolean)) throw new Error('유효한 PDF 파일만 업로드할 수 있습니다.');
  const total = files.reduce((sum, file) => sum + file.size, 0);
  let completedBytes = 0;
  const results: PdfInfo[] = [];
  for (const file of files) {
    let sessionResponse = await fetch(`/api/folders/${encodeURIComponent(folder)}/uploads/resumable`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: file.name, size: file.size, mimeType: file.type || 'application/pdf' }) });
    if (sessionResponse.status === 404) return null;
    let body = await sessionResponse.json() as ResumableSession & { error?: string };
    if (!sessionResponse.ok) throw new Error(body.error ?? '업로드 세션 생성 실패');
    for (let sessionAttempt = 0; ; sessionAttempt += 1) {
      try { await uploadPdfToResumableSession(body.sessionUrl, file, (loaded) => onProgress?.(Math.round(((completedBytes + loaded) / total) * 85))); break; }
      catch (error) {
        if (!(error instanceof ResumableSessionExpiredError) || sessionAttempt >= 1) throw error;
        sessionResponse = await fetch(`/api/folders/${encodeURIComponent(folder)}/uploads/resumable`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: file.name, size: file.size, mimeType: file.type || 'application/pdf' }) });
        body = await sessionResponse.json() as ResumableSession & { error?: string };
        if (!sessionResponse.ok) throw new Error(body.error ?? '업로드 세션 재생성 실패');
      }
    }
    onPhase?.('indexing');
    const completed = await request<PdfInfo>(`/folders/${encodeURIComponent(folder)}/uploads/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ driveFileId: body.driveFileId, filename: file.name, size: file.size }) });
    await upsertCachedFile(folder, completed);
    results.push(completed);
    completedBytes += file.size;
  }
  onPhase?.('refreshing'); onProgress?.(100);
  return results;
}

function legacyUpload(folder: string, files: File[], onProgress?: (pct: number) => void, onPhase?: (phase: 'uploading' | 'indexing' | 'refreshing') => void) {
  return new Promise<PdfInfo[]>((resolve, reject) => {
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/folders/${encodeURIComponent(folder)}/files`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 70)); };
    xhr.onload = async () => {
      let data: { error?: string } & PdfInfo[];
      try { data = JSON.parse(xhr.responseText) as typeof data; } catch { reject(new Error(`업로드 실패 (HTTP ${xhr.status})`)); return; }
      if (xhr.status >= 400) reject(new Error(data.error ?? '업로드 실패'));
      else { onPhase?.('indexing'); onProgress?.(85); await Promise.all((data as PdfInfo[]).map((file) => upsertCachedFile(folder, file))); resolve(data as PdfInfo[]); }
    };
    xhr.onerror = () => reject(new Error('네트워크 오류'));
    xhr.send(form);
  });
}

export const foldersApi = {
  list: async () => (await listCachedFolders()) ?? request<FolderInfo[]>('/folders'),

  refresh: async () => {
    await request<FolderInfo[]>('/folders/refresh', { method: 'POST' });
    await invalidatePdfitMetadataCache();
    return (await listCachedFolders()) ?? request<FolderInfo[]>('/folders');
  },

  create: async (name: string) => {
    const result = await request<FolderInfo>('/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    await upsertCachedFolder(result);
    return result;
  },

  rename: async (name: string, newName: string) => {
    const current = (await listCachedFolders())?.find((folder) => folder.name === name);
    const result = await request<FolderInfo>(`/folders/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newName, color: current?.color, createdAt: current?.createdAt }),
    });
    await upsertCachedFolder(result);
    return result;
  },

  delete: async (name: string) => {
    const result = await request<{ ok: boolean; driveFolderId: string }>(`/folders/${encodeURIComponent(name)}`, { method: 'DELETE' });
    await deleteCachedFolder(result.driveFolderId);
    return result;
  },

  updateColor: async (name: string, color: string) => {
    const result = await request<{ ok: boolean }>(`/folders/${encodeURIComponent(name)}/color`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ color }),
    });
    await updateCachedFolderColor(name, color);
    return result;
  },

  listFiles: async (folder: string) => (await listCachedFiles(folder)) ?? request<PdfInfo[]>(`/folders/${encodeURIComponent(folder)}/files`),

  upload: async (folder: string, files: File[], onProgress?: (pct: number) => void, onPhase?: (phase: 'uploading' | 'indexing' | 'refreshing') => void) =>
    (await directUpload(folder, files, onProgress, onPhase)) ?? legacyUpload(folder, files, onProgress, onPhase),

  deleteFile: async (folder: string, filename: string) => {
    const result = await request<{ ok: boolean } & PdfInfo>(
      `/folders/${encodeURIComponent(folder)}/files/${encodeURIComponent(filename)}`,
      { method: 'DELETE' },
    );
    if (result.driveFileId) await deleteCachedFile(result.driveFileId);
    return result;
  },

  moveFile: async (fromFolder: string, toFolder: string, filename: string) => {
    const result = await request<{ ok: boolean } & PdfInfo>('/folders/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromFolder, toFolder, filename }),
    });
    if (result.driveFileId) await moveCachedFile(result.driveFileId, toFolder);
    return result;
  },

  fileUrl: (folder: string, filename: string, driveFileId?: string | null) => driveFileId
    ? `/api/folders/by-id/${encodeURIComponent(driveFileId)}`
    : `/api/folders/${encodeURIComponent(folder)}/files/${encodeURIComponent(filename)}`,
};
