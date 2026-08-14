export interface ViewerStatePayload {
  page: number;
  scale: number;
  fitMode: 'none' | 'width' | 'height';
  viewMode: 'scroll' | 'single' | 'double';
  inverted: boolean;
  uiHidden: boolean;
  scrollTop: number;
}

export const viewerStateApi = {
  get: async (folder: string, filename: string): Promise<ViewerStatePayload | null> => {
    const res = await fetch(
      `/api/viewer-state/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`,
    );
    const data = await res.json();
    return data ?? null;
  },

  save: (folder: string, filename: string, state: ViewerStatePayload): void => {
    fetch(
      `/api/viewer-state/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      },
    ).catch(() => {});
  },
};
