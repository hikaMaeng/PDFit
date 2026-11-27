export interface PageTextRun {
  text: string;
  before?: ' ' | '\n';
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  direction?: string;
}

export interface SelectablePageText {
  width: number;
  height: number;
  source: 'pdf' | 'ocr';
  runs: PageTextRun[];
}

type PageReader = (pageIndex: number, signal: AbortSignal) => Promise<SelectablePageText>;
const CACHE_PAGES = 24;

/** One reader per open document. Pending work follows the visible pages. */
export class PageTextModel {
  private reader?: PageReader;
  private wanted: readonly number[] = [];
  private readonly pages = new Map<number, SelectablePageText>();
  private readonly failed = new Set<number>();
  private active?: { page: number; abort: AbortController };
  private readonly listeners = new Set<() => void>();
  private version = 0;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getVersion = () => this.version;
  getPage = (page: number) => this.pages.get(page);

  connect(reader: PageReader) {
    this.reader = reader;
    this.readNext();
    return () => {
      if (this.reader !== reader) return;
      this.reader = undefined;
      this.active?.abort.abort();
      this.active = undefined;
      this.pages.clear();
      this.failed.clear();
      this.emit();
    };
  }

  show(pages: readonly number[]) {
    this.wanted = pages.slice(0, CACHE_PAGES);
    for (const page of this.failed) {
      if (!pages.includes(page)) this.failed.delete(page);
    }
    for (const page of pages) {
      const cached = this.pages.get(page);
      if (!cached) continue;
      this.pages.delete(page);
      this.pages.set(page, cached);
    }
    if (this.active && !pages.includes(this.active.page)) this.active.abort.abort();
    this.readNext();
  }

  private readNext() {
    if (this.active || !this.reader) return;
    const page = this.wanted.find((candidate) => !this.pages.has(candidate) && !this.failed.has(candidate));
    if (page === undefined) return;
    const abort = new AbortController();
    const active = { page, abort };
    this.active = active;
    void this.reader(page, abort.signal).then((text) => {
      if (abort.signal.aborted) return;
      this.pages.set(page, text);
      const oldest = this.pages.keys().next().value;
      if (this.pages.size > CACHE_PAGES && oldest !== undefined) this.pages.delete(oldest);
      this.emit();
    }, () => {
      if (!abort.signal.aborted) this.failed.add(page);
    }).finally(() => {
      if (this.active !== active) return;
      this.active = undefined;
      this.readNext();
    });
  }

  private emit() {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}
