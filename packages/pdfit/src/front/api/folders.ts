import { uiText } from '../i18n/uiText.js';
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
  uploadedAt?: string;
  driveFileId?: string;
}

import { deleteCachedFile, deleteCachedFolder, invalidatePdfitMetadataCache, listCachedFiles, listCachedFolders, moveCachedFile, setCachedFileTrashed, setCachedFolderTrashed, updateCachedFolderColor, upsertCachedFile, upsertCachedFolder, upsertCachedSyncState } from '../cache/metadataCache.js';
import { isPdfFile, ResumableSessionExpiredError, uploadPdfToResumableSession } from '../upload/resumableUpload.js';
import { backgroundSyncModel } from '../model/backgroundSyncModel.js';
import { publishLibraryFileMutation } from '../model/libraryMutationEvents.js';
import { beginMutationPerformance } from '../model/mutationPerformance.js';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch('/api' + url, options);
  if (res.status === 204) return undefined as T;
  let data: { error?: string } & T;
  try { data = await res.json() as { error?: string } & T; }
  catch { throw new Error(responseError(res.status)); }
  if (!res.ok) throw new Error(res.status === 429 ? responseError(429) : data.error ?? responseError(res.status));
  return data as T;
}

function responseError(status: number): string {
  if (status === 429) return uiText("요청이 많아 잠시 지연되고 있습니다. 잠시 후 다시 시도해 주세요.");
  return uiText("요청을 처리하지 못했습니다 (HTTP {p0}).", { p0: status });
}

interface ResumableSession { driveFileId: string; sessionUrl: string; expiresAt: string; completed?: boolean }
interface RefreshResult {
  mode: 'delta' | 'replace'; folders: FolderInfo[]; folderUpserts: FolderInfo[]; folderDeletes: string[];
  fileUpserts: Array<PdfInfo & { folder: string }>; fileDeletes: string[];
  syncState?: { key: string; value: string; updatedAt: string };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function notifyFoldersChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('folders-changed'));
}

function runInBackground(label: string, action: () => Promise<void>, retry: () => void): void {
  const syncId = backgroundSyncModel.begin(label, retry);
  backgroundSyncModel.syncing(syncId);
  void action().then(() => backgroundSyncModel.complete(syncId)).catch((error) => {
    backgroundSyncModel.fail(syncId, errorMessage(error, `${label} failed.`), retry);
  });
}

async function directUpload(folder: string, files: File[], onProgress?: (pct: number) => void, onPhase?: (phase: 'uploading' | 'indexing' | 'refreshing') => void, operationIds?: string[]): Promise<PdfInfo[] | null> {
  if (!(await Promise.all(files.map(isPdfFile))).every(Boolean)) throw new Error(uiText("유효한 PDF 파일만 업로드할 수 있습니다."));
  if (files.length === 0) return [];
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const loadedBytes = files.map(() => 0);
  const results = new Array<PdfInfo>(files.length);
  const createSession = async (file: File, index: number) => {
    const startedAt = performance.now();
    const response = await fetch(`/api/folders/${encodeURIComponent(folder)}/uploads/resumable`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: file.name, size: file.size, mimeType: file.type || 'application/pdf', operationId: operationIds?.[index] }) });
    const body = await response.json().catch(() => ({ error: responseError(response.status) })) as ResumableSession & { error?: string };
    console.info('[library-performance]', JSON.stringify({ operation: 'upload.session-create', filename: file.name, durationMs: Math.round(performance.now() - startedAt) }));
    return { response, body };
  };
  const firstSession = await createSession(files[0], 0);
  if (firstSession.response.status === 404) return null;
  if (!firstSession.response.ok) throw new Error(firstSession.response.status === 429 ? responseError(429) : firstSession.body.error ?? uiText("업로드 세션 생성 실패"));
  let nextIndex = 0;
  const uploadOne = async (index: number) => {
    const file = files[index];
    let session = index === 0 ? firstSession : await createSession(file, index);
    if (!session.response.ok) throw new Error(session.response.status === 429 ? responseError(429) : session.body.error ?? uiText("업로드 세션 생성 실패"));
    const driveStartedAt = performance.now();
    for (let sessionAttempt = 0; !session.body.completed; sessionAttempt += 1) {
      try {
        await uploadPdfToResumableSession(session.body.sessionUrl, file, (loaded) => {
          loadedBytes[index] = loaded;
          onProgress?.(Math.round((loadedBytes.reduce((sum, value) => sum + value, 0) / total) * 85));
        });
        break;
      } catch (error) {
        if (!(error instanceof ResumableSessionExpiredError) || sessionAttempt >= 1) throw error;
        session = await createSession(file, index);
        if (!session.response.ok) throw new Error(session.response.status === 429 ? responseError(429) : session.body.error ?? uiText("업로드 세션 재생성 실패"));
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
      try { data = JSON.parse(xhr.responseText) as typeof data; } catch { reject(new Error(uiText("업로드 실패 (HTTP {p0})", { p0: xhr.status }))); return; }
      if (xhr.status >= 400) reject(new Error(data.error ?? uiText("업로드 실패")));
      else { onPhase?.('indexing'); onProgress?.(85); await Promise.all((data as PdfInfo[]).map((file) => upsertCachedFile(folder, file))); resolve(data as PdfInfo[]); }
    };
    xhr.onerror = () => reject(new Error(uiText("네트워크 오류")));
    xhr.send(form);
  });
}

function retryMutation(action: () => Promise<unknown>): void {
  void action().catch(() => undefined);
}

async function createFolderOptimistically(name: string): Promise<FolderInfo> {
  // The local runtime has no hydrated Drive metadata cache. In that mode the
  // server response is the source of truth, so navigation must wait until the
  // filesystem mutation succeeds. See docs/architecture.md.
  if ((await listCachedFolders()) === null) {
    return request<FolderInfo>('/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  }

  const timestamp = new Date().toISOString();
  const optimistic: FolderInfo = { name, pdfCount: 0, createdAt: timestamp, isRoot: false, color: '#3b82f6', driveFolderId: `pending-folder-${crypto.randomUUID()}`, parentFolderId: 'root' };
  const timing = beginMutationPerformance('folder.create');
  await upsertCachedFolder(optimistic);
  timing.mark('indexeddb');
  notifyFoldersChanged();
  timing.mark('ui');
  const retry = () => retryMutation(() => createFolderOptimistically(name));
  runInBackground('Creating folder', async () => {
    timing.mark('request-start');
    try {
      const saved = await request<FolderInfo>('/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      timing.mark('server-response');
      await deleteCachedFolder(optimistic.driveFolderId!);
      await upsertCachedFolder(saved);
      notifyFoldersChanged();
      timing.mark('sync-complete');
    } catch (error) {
      await deleteCachedFolder(optimistic.driveFolderId!).catch(() => undefined);
      notifyFoldersChanged();
      timing.mark('failed');
      throw error;
    }
  }, retry);
  return optimistic;
}

async function renameFolderOptimistically(name: string, newName: string): Promise<FolderInfo> {
  const current = (await listCachedFolders())?.find((folder) => folder.name === name);
  if (!current?.driveFolderId) return request<FolderInfo>(`/folders/${encodeURIComponent(name)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newName, color: current?.color, createdAt: current?.createdAt }) });
  const optimistic = { ...current, name: newName };
  const timing = beginMutationPerformance('folder.rename');
  await upsertCachedFolder(optimistic);
  timing.mark('indexeddb'); notifyFoldersChanged(); timing.mark('ui');
  const retry = () => retryMutation(() => renameFolderOptimistically(name, newName));
  runInBackground('Renaming folder', async () => {
    timing.mark('request-start');
    try {
      const saved = await request<FolderInfo>(`/folders/${encodeURIComponent(name)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newName, color: current.color, createdAt: current.createdAt }) });
      timing.mark('server-response'); await upsertCachedFolder(saved); notifyFoldersChanged(); timing.mark('sync-complete');
    } catch (error) {
      await upsertCachedFolder(current).catch(() => undefined); notifyFoldersChanged(); timing.mark('failed'); throw error;
    }
  }, retry);
  return optimistic;
}

async function renameFolderConfirmed(name: string, newName: string): Promise<FolderInfo> {
  const current = (await listCachedFolders())?.find((folder) => folder.name === name);
  const saved = await request<FolderInfo>(`/folders/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newName, color: current?.color, createdAt: current?.createdAt }),
  });
  if (saved.driveFolderId) await upsertCachedFolder(saved);
  notifyFoldersChanged();
  return saved;
}

async function deleteFolderOptimistically(name: string, waitForServer = false): Promise<{ ok: boolean; driveFolderId: string }> {
  const current = (await listCachedFolders())?.find((folder) => folder.name === name);
  if (!current?.driveFolderId) return request<{ ok: boolean; driveFolderId: string }>(`/folders/${encodeURIComponent(name)}`, { method: 'DELETE' });
  const currentId = current.driveFolderId;
  const timing = beginMutationPerformance('folder.delete');
  await setCachedFolderTrashed(currentId, true);
  timing.mark('indexeddb'); notifyFoldersChanged(); timing.mark('ui');
  const retry = () => retryMutation(() => deleteFolderOptimistically(name, false));
  const syncId = backgroundSyncModel.begin('Deleting folder', retry);
  backgroundSyncModel.syncing(syncId);
  const completion = (async () => {
    try {
      timing.mark('request-start');
      const saved = await request<{ ok: boolean; driveFolderId: string }>(`/folders/${encodeURIComponent(name)}`, { method: 'DELETE' });
      timing.mark('server-response');
      await deleteCachedFolder(saved.driveFolderId || currentId);
      timing.mark('sync-complete');
      backgroundSyncModel.complete(syncId);
      return { ok: true, driveFolderId: saved.driveFolderId || currentId };
    } catch (error) {
      await setCachedFolderTrashed(currentId, false).catch(() => undefined);
      notifyFoldersChanged(); timing.mark('failed');
      backgroundSyncModel.fail(syncId, errorMessage(error, 'Deleting folder failed.'), retry);
      throw error;
    }
  })();
  if (waitForServer) return completion;
  void completion.catch(() => undefined);
  return { ok: true, driveFolderId: currentId };
}

async function updateFolderColorOptimistically(name: string, color: string): Promise<{ ok: boolean }> {
  const current = (await listCachedFolders())?.find((folder) => folder.name === name);
  const timing = beginMutationPerformance('folder.color');
  await updateCachedFolderColor(name, color);
  timing.mark('indexeddb'); notifyFoldersChanged(); timing.mark('ui');
  const retry = () => retryMutation(() => updateFolderColorOptimistically(name, color));
  runInBackground('Saving folder color', async () => {
    timing.mark('request-start');
    try {
      await request<{ ok: boolean }>(`/folders/${encodeURIComponent(name)}/color`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ color }) });
      timing.mark('server-response'); timing.mark('sync-complete');
    } catch (error) {
      if (current) await updateCachedFolderColor(name, current.color).catch(() => undefined);
      notifyFoldersChanged(); timing.mark('failed'); throw error;
    }
  }, retry);
  return { ok: true };
}

async function deleteFileOptimistically(folder: string, filename: string, driveFileId?: string): Promise<{ ok: boolean } & PdfInfo> {
  const cached = (await listCachedFiles(folder))?.find((file) => driveFileId ? file.driveFileId === driveFileId : file.name === filename);
  if (!cached?.driveFileId) return request<{ ok: boolean } & PdfInfo>(`/folders/${encodeURIComponent(folder)}/files/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
    headers: driveFileId ? { 'Content-Type': 'application/json' } : undefined,
    body: driveFileId ? JSON.stringify({ driveFileId }) : undefined,
  });
  const timing = beginMutationPerformance('file.delete');
  publishLibraryFileMutation({ kind: 'remove', folder, filename, driveFileId: cached.driveFileId }); timing.mark('ui');
  await setCachedFileTrashed(cached.driveFileId, true); timing.mark('indexeddb'); notifyFoldersChanged();
  const retry = () => retryMutation(() => deleteFileOptimistically(folder, filename, cached.driveFileId));
  runInBackground('Deleting PDF', async () => {
    timing.mark('request-start');
    try {
      await request<{ ok: boolean } & PdfInfo>(`/folders/${encodeURIComponent(folder)}/files/${encodeURIComponent(filename)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ driveFileId: cached.driveFileId }) });
      timing.mark('server-response'); await deleteCachedFile(cached.driveFileId!); timing.mark('sync-complete');
    } catch (error) {
      await setCachedFileTrashed(cached.driveFileId!, false).catch(() => undefined);
      publishLibraryFileMutation({ kind: 'upsert', folder, file: cached }); notifyFoldersChanged(); timing.mark('failed'); throw error;
    }
  }, retry);
  return { ok: true, ...cached };
}

async function moveFileOptimistically(fromFolder: string, toFolder: string, filename: string, driveFileId?: string): Promise<{ ok: boolean } & PdfInfo> {
  const cached = (await listCachedFiles(fromFolder))?.find((file) => driveFileId ? file.driveFileId === driveFileId : file.name === filename);
  if (!cached?.driveFileId) return request<{ ok: boolean } & PdfInfo>('/folders/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fromFolder, toFolder, filename, ...(driveFileId ? { driveFileId } : {}) }) });
  const timing = beginMutationPerformance('file.move');
  publishLibraryFileMutation({ kind: 'remove', folder: fromFolder, filename, driveFileId: cached.driveFileId });
  publishLibraryFileMutation({ kind: 'upsert', folder: toFolder, file: cached });
  timing.mark('ui');
  await moveCachedFile(cached.driveFileId, toFolder); timing.mark('indexeddb'); notifyFoldersChanged();
  const retry = () => retryMutation(() => moveFileOptimistically(fromFolder, toFolder, filename, cached.driveFileId));
  runInBackground('Moving PDF', async () => {
    timing.mark('request-start');
    try {
      const saved = await request<{ ok: boolean } & PdfInfo>('/folders/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fromFolder, toFolder, filename, driveFileId: cached.driveFileId }) });
      timing.mark('server-response'); timing.mark('sync-complete');
      if (saved.driveFileId) await moveCachedFile(saved.driveFileId, toFolder);
    } catch (error) {
      await moveCachedFile(cached.driveFileId!, fromFolder).catch(() => undefined);
      publishLibraryFileMutation({ kind: 'remove', folder: toFolder, filename, driveFileId: cached.driveFileId });
      publishLibraryFileMutation({ kind: 'upsert', folder: fromFolder, file: cached });
      notifyFoldersChanged(); timing.mark('failed'); throw error;
    }
  }, retry);
  return { ok: true, ...cached };
}

const pendingUploads = new Map<string, PdfInfo>();

async function uploadFilesOptimistically(folder: string, files: File[], onProgress?: (pct: number) => void, onPhase?: (phase: 'uploading' | 'indexing' | 'refreshing') => void, retryOperationIds?: Map<string, string>): Promise<PdfInfo[]> {
  if (!(await Promise.all(files.map(isPdfFile))).every(Boolean)) throw new Error(uiText("유효한 PDF 파일만 업로드할 수 있습니다."));
  const timestamp = new Date().toISOString();
  const operations = files.map((file) => {
    const key = `${folder}\0${file.name}`;
    const existing = pendingUploads.get(key);
    if (existing) return { key, file, operationId: '', placeholder: existing, duplicate: true };
    const operationId = retryOperationIds?.get(key) ?? crypto.randomUUID();
    const placeholder: PdfInfo = { name: file.name, size: file.size, modifiedAt: timestamp, uploadedAt: timestamp, driveFileId: `pending-upload-${operationId}` };
    pendingUploads.set(key, placeholder);
    return { key, file, operationId, placeholder, duplicate: false };
  });
  const created = operations.filter((operation) => !operation.duplicate);
  for (const operation of created) publishLibraryFileMutation({ kind: 'upsert', folder, file: operation.placeholder });
  await Promise.all(created.map((operation) => upsertCachedFile(folder, operation.placeholder)));
  notifyFoldersChanged();
  const progress = new Map(created.map((operation) => [operation.key, 0]));
  const updateProgress = () => onProgress?.(Math.round([...progress.values()].reduce((sum, value) => sum + value, 0) / Math.max(1, progress.size)));
  let nextIndex = 0;
  const uploadOne = async (operation: typeof created[number]) => {
    const timing = beginMutationPerformance('file.upload', operation.operationId);
    timing.mark('ui'); timing.mark('indexeddb');
    const retry = () => retryMutation(() => uploadFilesOptimistically(folder, [operation.file], onProgress, onPhase, new Map([[operation.key, operation.operationId]])));
    const syncId = backgroundSyncModel.begin(`Uploading ${operation.file.name}`, retry);
    backgroundSyncModel.syncing(syncId); timing.mark('request-start');
    try {
      const result = (await directUpload(folder, [operation.file], (value) => { progress.set(operation.key, value); updateProgress(); }, (phase) => {
        onPhase?.(phase);
        backgroundSyncModel.setLabel(syncId, phase === 'uploading' ? `Uploading ${operation.file.name}` : `Saving ${operation.file.name}`);
      }, [operation.operationId])) ?? await legacyUpload(folder, [operation.file]);
      const saved = result[0];
      timing.mark('server-response');
      await deleteCachedFile(operation.placeholder.driveFileId!);
      await upsertCachedFile(folder, saved);
      publishLibraryFileMutation({ kind: 'remove', folder, filename: operation.file.name, driveFileId: operation.placeholder.driveFileId });
      publishLibraryFileMutation({ kind: 'upsert', folder, file: saved });
      notifyFoldersChanged(); timing.mark('sync-complete'); backgroundSyncModel.complete(syncId);
    } catch (error) {
      await deleteCachedFile(operation.placeholder.driveFileId!).catch(() => undefined);
      publishLibraryFileMutation({ kind: 'remove', folder, filename: operation.file.name, driveFileId: operation.placeholder.driveFileId });
      notifyFoldersChanged(); timing.mark('failed');
      backgroundSyncModel.fail(syncId, errorMessage(error, 'Upload failed.'), retry);
    } finally {
      pendingUploads.delete(operation.key);
    }
  };
  const workers = Array.from({ length: Math.min(3, created.length) }, async () => {
    while (nextIndex < created.length) { const index = nextIndex; nextIndex += 1; await uploadOne(created[index]); }
  });
  void Promise.all(workers);
  return operations.map((operation) => operation.placeholder);
}

export const foldersApi = {
  list: async () => (await listCachedFolders()) ?? request<FolderInfo[]>('/folders'),

  refresh: async () => {
    const result = await request<FolderInfo[] | RefreshResult>('/folders/refresh', { method: 'POST' });
    if (Array.isArray(result) || result.mode === 'replace') {
      await invalidatePdfitMetadataCache();
      return (await listCachedFolders()) ?? (Array.isArray(result) ? result : result.folders);
    }
    for (const driveFolderId of result.folderDeletes) await deleteCachedFolder(driveFolderId);
    for (const driveFileId of result.fileDeletes) await deleteCachedFile(driveFileId);
    for (const folder of result.folderUpserts) await upsertCachedFolder(folder);
    for (const file of result.fileUpserts) await upsertCachedFile(file.folder, file);
    if (result.syncState) await upsertCachedSyncState(result.syncState);
    return result.folders;
  },

  create: createFolderOptimistically,

  rename: renameFolderOptimistically,
  renameConfirmed: renameFolderConfirmed,

  delete: (name: string) => deleteFolderOptimistically(name, false),

  /** Destructive UI flow: keep optimistic feedback but resolve only after Drive confirms deletion. */
  deleteConfirmed: (name: string) => deleteFolderOptimistically(name, true),

  updateColor: updateFolderColorOptimistically,

  listFiles: async (folder: string) => {
    const cached = await listCachedFiles(folder);
    if (!cached) return request<PdfInfo[]>(`/folders/${encodeURIComponent(folder)}/files`);
    const activeIds = new Set([...pendingUploads.values()].map((file) => file.driveFileId));
    const stale = cached.filter((file) => file.driveFileId?.startsWith('pending-upload-') && !activeIds.has(file.driveFileId));
    await Promise.all(stale.map((file) => deleteCachedFile(file.driveFileId!)));
    return cached.filter((file) => !stale.includes(file));
  },

  upload: uploadFilesOptimistically,

  deleteFile: deleteFileOptimistically,

  moveFile: moveFileOptimistically,

  fileUrl: (folder: string, filename: string, driveFileId?: string | null) => driveFileId
    ? `/api/folders/by-id/${encodeURIComponent(driveFileId)}`
    : `/api/folders/${encodeURIComponent(folder)}/files/${encodeURIComponent(filename)}`,

  /** Remote thumbnail. With `modifiedAt` and `size` the URL carries the same `v` stamp as a local one. */
  thumbnailUrl: (driveFileId?: string | null, modifiedAt?: string, size?: number) => {
    if (!driveFileId || driveFileId.startsWith('pending-upload-')) return undefined;
    const base = `/api/folders/by-id/${encodeURIComponent(driveFileId)}/thumbnail`;
    const modifiedAtMs = modifiedAt ? Date.parse(modifiedAt) : Number.NaN;
    return Number.isFinite(modifiedAtMs) && typeof size === 'number' && Number.isFinite(size)
      ? `${base}?v=${Math.trunc(modifiedAtMs)}-${Math.trunc(size)}`
      : base;
  },

  /**
   * Cover of a local library file, rendered by the server's thumbnail task. `v` is the
   * file's modification time and size, so the URL changes when the file does and the
   * image can be cached for good.
   */
  localThumbnailUrl: (folder: string, filename: string, modifiedAt?: string, size?: number) => {
    const base = `/api/folders/${encodeURIComponent(folder)}/files/${encodeURIComponent(filename)}/thumbnail`;
    const modifiedAtMs = modifiedAt ? Date.parse(modifiedAt) : Number.NaN;
    return Number.isFinite(modifiedAtMs) && typeof size === 'number' && Number.isFinite(size)
      ? `${base}?v=${Math.trunc(modifiedAtMs)}-${Math.trunc(size)}`
      : base;
  },
};
