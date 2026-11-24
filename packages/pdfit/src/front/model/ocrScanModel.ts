import { isOcrScanActive, type OcrScanJob } from '../../common/protocol/ocr/scan.js';
import { changeOcrScan, getOcrScan, type OcrScanBook } from '../api/ocr.js';

class OcrScanModel {
  private version = 0;
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private requestVersion = 0;
  private currentJob: OcrScanJob | null = null;
  private changePending: 'start' | 'cancel' | null = null;
  private requestFailed = false;

  constructor(readonly book: OcrScanBook) {}

  get job() { return this.currentJob; }
  get pending() { return this.changePending; }
  get failed() { return this.requestFailed; }
  getVersion = () => this.version;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) void this.refresh();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) clearTimeout(this.timer);
    };
  };

  private emit() {
    this.version += 1;
    this.listeners.forEach((listener) => listener());
  }

  private schedule() {
    clearTimeout(this.timer);
    if (this.listeners.size) {
      this.timer = setTimeout(() => void this.refresh(), isOcrScanActive(this.job) ? 750 : 5_000);
    }
  }

  async refresh() {
    if (this.pending) return;
    clearTimeout(this.timer);
    const request = ++this.requestVersion;
    try {
      const { job } = await getOcrScan(this.book);
      if (request !== this.requestVersion) return;
      const previous = this.job;
      if (previous?.id === job?.id && previous?.status === job?.status && previous?.activePages.join() === job?.activePages.join()
        && previous?.pageCount === job?.pageCount && previous?.processedPages === job?.processedPages && !this.failed) return;
      this.currentJob = job;
      this.requestFailed = false;
      this.emit();
    } catch {
      if (request !== this.requestVersion || this.failed) return;
      this.requestFailed = true;
      this.emit();
    } finally {
      if (request === this.requestVersion) this.schedule();
    }
  }

  async change(change: { startPage: number } | { id: string }) {
    if (this.pending) return;
    clearTimeout(this.timer);
    this.requestVersion += 1;
    this.changePending = 'id' in change ? 'cancel' : 'start';
    this.requestFailed = false;
    this.emit();
    try {
      this.currentJob = (await changeOcrScan(this.book, change)).job;
    } catch {
      this.requestFailed = true;
    } finally {
      this.changePending = null;
      this.emit();
      this.schedule();
    }
  }
}

const models = new Map<string, OcrScanModel>();

export function getOcrScanModel(folder: string, filename: string) {
  const key = JSON.stringify([folder, filename]);
  let model = models.get(key);
  if (!model) {
    model = new OcrScanModel({ folder, filename });
    models.set(key, model);
  }
  return model;
}
