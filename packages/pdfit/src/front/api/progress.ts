import { getCachedProgress, saveCachedProgress } from '../cache/metadataCache.js';
import { requestWithMetadataOutbox } from '../cache/metadataOutbox.js';

const pendingProgress = new Map<string, ReturnType<typeof setTimeout>>();
export const progressApi = {
  get: async (folder: string, filename: string): Promise<number> => {
    const cached = await getCachedProgress(folder, filename); if (cached != null) return cached;
    const res = await fetch(
      `/api/progress/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`,
    );
    const data = await res.json();
    return data.page ?? 1;
  },

  save: (folder: string, filename: string, page: number): void => {
    void saveCachedProgress(folder, filename, page);
    const key = `${folder}\0${filename}`; const previous = pendingProgress.get(key); if (previous) clearTimeout(previous);
    pendingProgress.set(key, setTimeout(() => { pendingProgress.delete(key); void requestWithMetadataOutbox({ coalesceKey: `progress:${key}`, url: `/api/progress/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`, method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page }) }).catch(() => {}); }, 750));
  },
};
