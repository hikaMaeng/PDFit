export interface ViewerStatePayload {
  page: number;
  scale: number;
  fitMode: 'none' | 'width' | 'height';
  viewMode: 'scroll' | 'single' | 'double';
  inverted: boolean;
  uiHidden: boolean;
  scrollTop: number;
}
import { getCachedViewerState, saveCachedViewerState } from '../cache/metadataCache.js';
import { requestWithMetadataOutbox } from '../cache/metadataOutbox.js';
const pendingViewerState = new Map<string, ReturnType<typeof setTimeout>>();
const stateUrl = (folder: string, filename: string, driveFileId?: string | null) => {
  const path = `/api/viewer-state/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`;
  return driveFileId ? `${path}?driveFileId=${encodeURIComponent(driveFileId)}` : path;
};

export const viewerStateApi = {
  get: async (folder: string, filename: string, driveFileId?: string | null): Promise<ViewerStatePayload | null> => {
    const cached = await getCachedViewerState(folder, filename, driveFileId); if (cached !== undefined) return cached;
    const res = await fetch(stateUrl(folder, filename, driveFileId));
    const data = await res.json();
    return data ?? null;
  },

  save: (folder: string, filename: string, state: ViewerStatePayload, driveFileId?: string | null): void => {
    void saveCachedViewerState(folder, filename, state, driveFileId);
    const key = driveFileId ?? `${folder}\0${filename}`; const previous = pendingViewerState.get(key); if (previous) clearTimeout(previous);
    pendingViewerState.set(key, setTimeout(() => { pendingViewerState.delete(key); void requestWithMetadataOutbox({ coalesceKey: `viewer:${key}`, url: stateUrl(folder, filename, driveFileId), method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) }).catch(() => {}); }, 750));
  },
};
