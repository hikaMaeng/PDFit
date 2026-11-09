import { getCachedProgress, saveCachedProgress } from '../cache/metadataCache.js';
import { requestWithMetadataOutbox } from '../cache/metadataOutbox.js';

const pendingProgress = new Map<string, ReturnType<typeof setTimeout>>();
const progressUrl = (folder: string, filename: string, driveFileId?: string | null) => {
  const path = `/api/progress/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`;
  return driveFileId ? `${path}?driveFileId=${encodeURIComponent(driveFileId)}` : path;
};
export const progressApi = {
  get: async (folder: string, filename: string, driveFileId?: string | null): Promise<number> => {
    const cached = await getCachedProgress(folder, filename, driveFileId); if (cached != null) return cached;
    const res = await fetch(progressUrl(folder, filename, driveFileId));
    const data = await res.json();
    return data.page ?? 1;
  },

  save: (folder: string, filename: string, page: number, driveFileId?: string | null): void => {
    void saveCachedProgress(folder, filename, page, driveFileId);
    const key = driveFileId ?? `${folder}\0${filename}`; const previous = pendingProgress.get(key); if (previous) clearTimeout(previous);
    pendingProgress.set(key, setTimeout(() => { pendingProgress.delete(key); void requestWithMetadataOutbox({ coalesceKey: `progress:${key}`, url: progressUrl(folder, filename, driveFileId), method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page }) }).catch(() => {}); }, 750));
  },
};
