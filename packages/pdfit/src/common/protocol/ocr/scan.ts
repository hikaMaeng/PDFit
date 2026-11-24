export interface OcrScanJob {
  id: string;
  status: 'running' | 'cancelling' | 'stopping' | 'completed' | 'cancelled' | 'failed';
  startPage: number;
  pageCount: number | null;
  activePages: number[];
  processedPages: number;
  failure?: 'unavailable' | 'source-changed' | 'error';
  failedPage?: number;
}

export function isOcrScanActive(job: OcrScanJob | null): boolean {
  return job?.status === 'running' || job?.status === 'cancelling' || job?.status === 'stopping';
}
