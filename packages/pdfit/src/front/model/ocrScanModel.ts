import { isOcrScanActive, type OcrScanJob } from '../../common/protocol/ocr/scan.js';
import { changeOcrScan, getOcrScan, listOcrScanPages, type OcrScanBook } from '../api/ocr.js';

const IDLE_POLL_MS = 5_000;

class OcrScanModel {
  private version = 0;
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private requestVersion = 0;
  private currentJob: OcrScanJob | null = null;
  private changePending: 'start' | 'cancel' | null = null;
  private requestFailed = false;
  private savedPages: ReadonlySet<number> | null = null;
  private pagesPending = false;
  private pagesRequestFailed = false;
  private lastPagesRequest = 0;

  constructor(readonly book: OcrScanBook) {}

  get job() { return this.currentJob; }
  get pending() { return this.changePending; }
  get failed() { return this.requestFailed; }
  get pages() { return this.savedPages; }
  get pagesFailed() { return this.pagesRequestFailed; }
  getVersion = () => this.version;

  scannedPercent(pageCount: number) {
    if (!this.pages || pageCount < 1) return null;
    let count = 0;
    for (const page of this.pages) {
      if (page >= 0 && page < pageCount) count += 1;
    }
    return Math.floor(100 * count / pageCount);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      void this.refreshPages();
      void this.refresh();
    }
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
      this.timer = setTimeout(() => void this.refresh(), isOcrScanActive(this.job) ? 750 : IDLE_POLL_MS);
    }
  }

  async refresh() {
    if (this.pending) return;
    clearTimeout(this.timer);
    if (Date.now() - this.lastPagesRequest >= IDLE_POLL_MS) void this.refreshPages();
    const request = ++this.requestVersion;
    try {
      const { job } = await getOcrScan(this.book);
      if (request !== this.requestVersion) return;
      const previous = this.job;
      if (previous?.processedPages !== job?.processedPages) void this.refreshPages();
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

  refreshPages = async () => {
    if (this.pagesPending) return;
    this.pagesPending = true;
    this.lastPagesRequest = Date.now();
    try {
      const { pages } = await listOcrScanPages(this.book);
      const saved = new Set(pages);
      const previous = this.pages;
      if (!this.pagesFailed && previous?.size === saved.size && pages.every((page) => previous.has(page))) return;
      this.savedPages = saved;
      this.pagesRequestFailed = false;
      this.emit();
    } catch {
      if (this.pagesFailed) return;
      this.pagesRequestFailed = true;
      this.emit();
    } finally {
      this.pagesPending = false;
    }
  };

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
