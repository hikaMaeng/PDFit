import { getCachedPageText, recognizePageText, type PageOcrResult } from '../api/ocr.js';

type PageOcrState =
  | { status: 'checking' }
  | { status: 'unscanned' }
  | { status: 'pending'; slowHint: boolean }
  | { status: 'ready'; result: PageOcrResult }
  | { status: 'failed'; during: 'lookup' | 'scan'; error: unknown };

type Target = { folder: string; filename: string; page: number; pageCount: number };
type Scan = { controller: AbortController; slowHint: boolean };

const SLOW_HINT_MS = 4_000;

class PageOcrModel {
  target: Target | null = null;
  state: PageOcrState = { status: 'checking' };
  private lookup: AbortController | undefined;
  private readonly scans = new Map<number, Scan>();
  private version = 0;
  private readonly listeners = new Set<() => void>();

  getVersion = () => this.version;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(state: PageOcrState) {
    this.state = state;
    this.version += 1;
    this.listeners.forEach((listener) => listener());
  }

  open(folder: string, filename: string, page: number, pageCount: number) {
    this.close();
    this.target = { folder, filename, page, pageCount };
    this.checkPage();
  }

  close = () => {
    if (!this.target) return;
    this.target = null;
    this.lookup?.abort();
    this.lookup = undefined;
    for (const scan of this.scans.values()) scan.controller.abort();
    this.scans.clear();
    this.publish({ status: 'checking' });
  };

  move(offset: number) {
    if (!this.target) return;
    const page = this.target.page + offset;
    if (page < 1 || page > this.target.pageCount) return;
    this.target.page = page;
    this.checkPage();
  }

  checkPage = () => {
    if (!this.target) return;
    const { folder, filename, page } = this.target;
    this.lookup?.abort();
    this.lookup = undefined;
    const scan = this.scans.get(page);
    if (scan) {
      this.publish({ status: 'pending', slowHint: scan.slowHint });
      return;
    }
    const controller = new AbortController();
    this.lookup = controller;
    this.publish({ status: 'checking' });
    void getCachedPageText(folder, filename, page - 1, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        this.lookup = undefined;
        this.publish(result ? { status: 'ready', result } : { status: 'unscanned' });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        this.lookup = undefined;
        this.publish({ status: 'failed', during: 'lookup', error });
      },
    );
  };

  scanPage = () => {
    if (!this.target || this.state.status === 'checking' || this.state.status === 'pending') return;
    const { folder, filename, page } = this.target;
    const controller = new AbortController();
    const scan = { controller, slowHint: false };
    this.scans.set(page, scan);
    this.publish({ status: 'pending', slowHint: false });
    const slow = setTimeout(() => {
      scan.slowHint = true;
      if (this.target?.page === page) this.publish({ status: 'pending', slowHint: true });
    }, SLOW_HINT_MS);
    controller.signal.addEventListener('abort', () => clearTimeout(slow), { once: true });
    const finish = (state: PageOcrState) => {
      clearTimeout(slow);
      if (controller.signal.aborted) return;
      this.scans.delete(page);
      if (this.target?.page === page) this.publish(state);
    };
    // The server can finish and cache an explicit scan even after the reader closes the dialog.
    void recognizePageText(folder, filename, page - 1, controller.signal).then(
      (result) => finish({ status: 'ready', result }),
      (error: unknown) => finish({ status: 'failed', during: 'scan', error }),
    );
  };
}

// Each viewer runs in its own browser window.
export const pageOcrModel = new PageOcrModel();
