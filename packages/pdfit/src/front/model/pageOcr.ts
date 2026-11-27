import { getCachedPageText, OcrSaveConflictError, recognizePageText, savePageText, type PageOcrResult } from '../api/ocr.js';
import type { AiModelProgress } from '../../common/protocol/ai-model/index.js';

type PageOcrState =
  | { status: 'checking' }
  | { status: 'unscanned' }
  | { status: 'pending'; slowHint: boolean; modelPhase?: AiModelProgress }
  | { status: 'ready'; result: PageOcrResult }
  | { status: 'editing'; result: PageOcrResult; draft: string; saving: boolean; saveError?: 'failed' | 'conflict' }
  | { status: 'failed'; during: 'lookup' | 'scan'; error: unknown };

type Target = { folder: string; filename: string; page: number; pageCount: number };
type Scan = { controller: AbortController; slowHint: boolean; modelPhase?: AiModelProgress };

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
    if (this.target?.folder === folder && this.target.filename === filename) {
      this.move(page - this.target.page);
      return;
    }
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
    if (!this.target || !offset || this.state.status === 'editing') return;
    const page = this.target.page + offset;
    if (page < 1 || page > this.target.pageCount) return;
    this.target.page = page;
    this.checkPage();
  }

  checkPage = () => {
    if (!this.target || this.state.status === 'editing') return;
    const { folder, filename, page } = this.target;
    this.lookup?.abort();
    this.lookup = undefined;
    const scan = this.scans.get(page);
    if (scan) {
      this.publish({ status: 'pending', slowHint: scan.slowHint, modelPhase: scan.modelPhase });
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

  edit = () => {
    if (this.state.status !== 'ready' || !this.state.result.revision) return;
    const { result } = this.state;
    this.publish({ status: 'editing', result, draft: result.text, saving: false });
  };

  changeDraft = (draft: string) => {
    if (this.state.status !== 'editing' || this.state.saving) return;
    this.publish({ ...this.state, draft });
  };

  cancelEdit = () => {
    if (this.state.status !== 'editing' || this.state.saving) return;
    const { result, saveError } = this.state;
    this.publish({ status: 'ready', result });
    if (saveError === 'conflict') this.checkPage();
  };

  save = async () => {
    const { target, state } = this;
    if (!target || state.status !== 'editing' || state.saving || state.saveError === 'conflict' || !state.result.revision) return;
    const saving = { ...state, saving: true, saveError: undefined };
    this.publish(saving);
    try {
      const result = await savePageText(target.folder, target.filename, target.page - 1, state.result.revision, state.draft);
      if (this.state === saving) this.publish({ status: 'ready', result });
    } catch (error) {
      if (this.state === saving) this.publish({ ...state, saveError: error instanceof OcrSaveConflictError ? 'conflict' : 'failed' });
    }
  };

  scanPage = () => {
    if (!this.target || this.state.status === 'checking' || this.state.status === 'pending' || this.state.status === 'editing') return;
    const { folder, filename, page } = this.target;
    const controller = new AbortController();
    const scan: Scan = { controller, slowHint: false };
    this.scans.set(page, scan);
    this.publish({ status: 'pending', slowHint: false });
    const slow = setTimeout(() => {
      scan.slowHint = true;
      if (this.target?.page === page) this.publish({ status: 'pending', slowHint: true, modelPhase: scan.modelPhase });
    }, SLOW_HINT_MS);
    controller.signal.addEventListener('abort', () => clearTimeout(slow), { once: true });
    const finish = (state: PageOcrState) => {
      clearTimeout(slow);
      if (controller.signal.aborted) return;
      this.scans.delete(page);
      if (this.target?.page === page) this.publish(state);
    };
    // The server can finish and cache an explicit scan even after the reader closes the dialog.
    void recognizePageText(folder, filename, page - 1, controller.signal, (modelPhase) => {
      if (controller.signal.aborted) return;
      scan.modelPhase = modelPhase;
      if (this.target?.page === page) this.publish({ status: 'pending', slowHint: scan.slowHint, modelPhase });
    }).then(
      (result) => finish({ status: 'ready', result }),
      (error: unknown) => finish({ status: 'failed', during: 'scan', error }),
    );
  };
}

// Each viewer runs in its own browser window.
export const pageOcrModel = new PageOcrModel();
