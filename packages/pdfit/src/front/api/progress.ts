export const progressApi = {
  get: async (folder: string, filename: string): Promise<number> => {
    const res = await fetch(
      `/api/progress/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`,
    );
    const data = await res.json();
    return data.page ?? 1;
  },

  save: (folder: string, filename: string, page: number): void => {
    fetch(
      `/api/progress/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page }),
      },
    ).catch(() => {});
  },
};
