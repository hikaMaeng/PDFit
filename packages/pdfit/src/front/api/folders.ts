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
  if (files.length === 0) return [];
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const loadedBytes = files.map(() => 0);
  const results = new Array<PdfInfo>(files.length);
  const createSession = async (file: File) => {
    const startedAt = performance.now();
    const response = await fetch(`/api/folders/${encodeURIComponent(folder)}/uploads/resumable`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: file.name, size: file.size, mimeType: file.type || 'application/pdf' }) });
    const body = await response.json() as ResumableSession & { error?: string };
    console.info('[library-performance]', JSON.stringify({ operation: 'upload.session-create', filename: file.name, durationMs: Math.round(performance.now() - startedAt) }));
    return { response, body };
  };
  const firstSession = await createSession(files[0]);
  if (firstSession.response.status === 404) return null;
  if (!firstSession.response.ok) throw new Error(firstSession.body.error ?? '업로드 세션 생성 실패');
  let nextIndex = 0;
  const uploadOne = async (index: number) => {
    const file = files[index];
    let session = index === 0 ? firstSession : await createSession(file);
    if (!session.response.ok) throw new Error(session.body.error ?? '업로드 세션 생성 실패');
    const driveStartedAt = performance.now();
    for (let sessionAttempt = 0; ; sessionAttempt += 1) {
      try {
        await uploadPdfToResumableSession(session.body.sessionUrl, file, (loaded) => {
          loadedBytes[index] = loaded;
          onProgress?.(Math.round((loadedBytes.reduce((sum, value) => sum + value, 0) / total) * 85));
        });
        break;
      } catch (error) {
        if (!(error instanceof ResumableSessionExpiredError) || sessionAttempt >= 1) throw error;
        session = await createSession(file);
        if (!session.response.ok) throw new Error(session.body.error ?? '업로드 세션 재생성 실패');
      }
    }
    console.info('[library-performance]', JSON.stringify({ operation: 'upload.browser-to-drive', filename: file.name, durationMs: Math.round(performance.now() - driveStartedAt), bytes: file.size }));
    onPhase?.('indexing');
    const completed = await request<PdfInfo>(`/folders/${encodeURIComponent(folder)}/uploads/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ driveFileId: session.body.driveFileId, filename: file.name, size: file.size }) });
    await upsertCachedFile(folder, completed);
    loadedBytes[index] = file.size;
    results[index] = completed;
  };
  const workers = Array.from({ length: Math.min(3, files.length) }, async () => {
    while (nextIndex < files.length) { const index = nextIndex; nextIndex += 1; await uploadOne(index); }
  });
  await Promise.all(workers);
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
    const cached = (await listCachedFiles(folder))?.find((file) => file.name === filename);
    const result = await request<{ ok: boolean } & PdfInfo>(
      `/folders/${encodeURIComponent(folder)}/files/${encodeURIComponent(filename)}`,
      { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ driveFileId: cached?.driveFileId }) },
    );
    if (result.driveFileId) await deleteCachedFile(result.driveFileId);
    return result;
  },

  moveFile: async (fromFolder: string, toFolder: string, filename: string) => {
    const cached = (await listCachedFiles(fromFolder))?.find((file) => file.name === filename);
    const result = await request<{ ok: boolean } & PdfInfo>('/folders/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromFolder, toFolder, filename, driveFileId: cached?.driveFileId }),
    });
    if (result.driveFileId) await moveCachedFile(result.driveFileId, toFolder);
    return result;
  },

  fileUrl: (folder: string, filename: string, driveFileId?: string | null) => driveFileId
    ? `/api/folders/by-id/${encodeURIComponent(driveFileId)}`
    : `/api/folders/${encodeURIComponent(folder)}/files/${encodeURIComponent(filename)}`,
};
