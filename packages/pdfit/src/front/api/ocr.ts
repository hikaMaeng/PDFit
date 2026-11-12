/** Page OCR (local runtime): the PDF text layer, else the Settings vision model. */
export interface PageOcrResult {
  text: string;
  source: 'text-layer' | 'vision' | 'none';
  cached: boolean;
  pageIndex: number;
  pageCount: number;
  durationMs: number;
}

export async function recognizePageText(folder: string, filename: string, pageIndex: number, signal?: AbortSignal): Promise<PageOcrResult> {
  const response = await fetch('/api/ocr/page', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder, filename, pageIndex }),
    signal,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? `HTTP ${response.status}`);
  }
  return response.json() as Promise<PageOcrResult>;
}
