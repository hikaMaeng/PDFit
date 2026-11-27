import { getCachedViewerState, saveCachedViewerState } from '../cache/metadataCache.js';
import { requestWithMetadataOutbox } from '../cache/metadataOutbox.js';

export interface ViewerStatePayload {
  page: number;
  scale: number;
  fitMode: 'none' | 'width' | 'height';
  viewMode: 'scroll' | 'single' | 'double';
  inverted: boolean;
  uiHidden: boolean;
  scrollTop: number;
}
export type ViewerStateReporter = (state: Omit<ViewerStatePayload, 'uiHidden'>, immediate?: boolean) => void | Promise<void>;

const pendingViewerState = new Map<string, ReturnType<typeof setTimeout>>();
const savingViewerState = new Map<string, Promise<void>>();
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

  save: (folder: string, filename: string, state: ViewerStatePayload, driveFileId?: string | null, immediate = false): void | Promise<void> => {
    const cached = saveCachedViewerState(folder, filename, state, driveFileId).catch(() => {});
    const key = driveFileId ?? `${folder}\0${filename}`;
    const pending = pendingViewerState.get(key);
    if (pending) clearTimeout(pending);
    pendingViewerState.delete(key);

    const send = () => {
      const write = async () => {
        const response = await requestWithMetadataOutbox({
          coalesceKey: `viewer:${key}`,
          url: stateUrl(folder, filename, driveFileId),
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state),
        }, immediate);
        if (!response.ok) throw new Error(`Viewer state save failed: HTTP ${response.status}`);
        await cached;
      };
      const previous = savingViewerState.get(key);
      const saving = previous ? previous.catch(() => {}).then(write) : write();
      savingViewerState.set(key, saving);
      return saving.finally(() => {
        if (savingViewerState.get(key) === saving) savingViewerState.delete(key);
      });
    };
    if (immediate) return send();
    pendingViewerState.set(key, setTimeout(() => {
      pendingViewerState.delete(key);
      void send().catch(() => {});
    }, 750));
  },
};
