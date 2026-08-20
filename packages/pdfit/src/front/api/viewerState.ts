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
const pendingViewerState = new Map<string, ReturnType<typeof setTimeout>>();

export const viewerStateApi = {
  get: async (folder: string, filename: string): Promise<ViewerStatePayload | null> => {
    const cached = await getCachedViewerState(folder, filename); if (cached !== undefined) return cached;
    const res = await fetch(
      `/api/viewer-state/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`,
    );
    const data = await res.json();
    return data ?? null;
  },

  save: (folder: string, filename: string, state: ViewerStatePayload): void => {
    void saveCachedViewerState(folder, filename, state);
    const key = `${folder}\0${filename}`; const previous = pendingViewerState.get(key); if (previous) clearTimeout(previous);
    pendingViewerState.set(key, setTimeout(() => { pendingViewerState.delete(key); fetch(
      `/api/viewer-state/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      },
    ).catch(() => {}); }, 750));
  },
};
