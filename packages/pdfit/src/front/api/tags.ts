export interface BookRef {
  folder: string;
  filename: string;
  size: number;
  modified_at: string;
  tags: string[];
}

export interface TagSummary {
  name: string;
  bookCount: number;
  color: string;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch('/api' + url, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? '요청 실패');
  return data as T;
}

export const tagsApi = {
  /** 전체 태그 목록 */
  list: () => request<string[]>('/tags'),

  /** 태그별 소속 PDF 수 */
  listSummary: () => request<TagSummary[]>('/tags/summary'),

  /** 태그와 해당 태그가 붙은 모든 PDF의 연결을 삭제 */
  delete: (tag: string) =>
    request<{ ok: boolean }>(`/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' }),
  updateColor: (tag: string, color: string) =>
    request<{ ok: boolean }>(`/tags/${encodeURIComponent(tag)}/color`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ color }),
    }),

  /** 특정 태그의 PDF 목록 */
  listBooks: (tag: string) =>
    request<BookRef[]>(`/tags/${encodeURIComponent(tag)}/books`),

  /** 폴더 내 모든 PDF의 태그를 한 번에 조회 → { filename: string[] } */
  listForFolder: (folder: string) =>
    request<Record<string, string[]>>(`/tags/folder/${encodeURIComponent(folder)}`),

  /** 특정 PDF의 태그 목록 */
  listForBook: (folder: string, filename: string) =>
    request<string[]>(
      `/tags/book/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`,
    ),

  /** PDF에 태그 추가 */
  addTag: (folder: string, filename: string, tag: string) =>
    request<{ ok: boolean }>(
      `/tags/book/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag }),
      },
    ),

  /** PDF에서 태그 제거 */
  removeTag: (folder: string, filename: string, tag: string) =>
    request<{ ok: boolean }>(
      `/tags/book/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}/${encodeURIComponent(tag)}`,
      { method: 'DELETE' },
    ),
};
