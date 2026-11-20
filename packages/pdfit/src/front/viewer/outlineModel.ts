import { BOOK_OUTLINE_MAX_ENTRIES, parseBookOutlineEntries, type BookOutlineEntry } from '../../common/protocol/outlines/index.js';
import { hasOutlineDestination, loadOutlineWithStorage, tryReadPdfOutline, type OutlineReader, type PdfOutlineStorage, type ViewerOutlineResult } from './storedOutline.js';

type DraftRow = { id: number; entry?: BookOutlineEntry };

// See docs/api.md#table-of-contents-endpoints for storage and initialization semantics.
export class OutlineModel {
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private nextRow = 0;
  result: ViewerOutlineResult | null = null;
  canSave = false;
  pending: 'load' | 'change' | null = null;
  error: 'empty' | 'read' | 'write' | 'invalid' | null = null;
  mode: 'view' | 'edit' | 'delete' = 'view';
  readonly draft: DraftRow[] = [];

  constructor(private readonly readPdf: OutlineReader, private readonly storage?: PdfOutlineStorage | null) {}

  getVersion = () => this.version;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private emit() {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  load = async () => {
    if (this.pending) return;
    this.pending = 'load';
    this.resetView();
    this.emit();
    try {
      const { result, canSave } = await loadOutlineWithStorage(this.readPdf, this.storage);
      this.result = result;
      this.canSave = canSave;
    } finally {
      this.pending = null;
      this.emit();
    }
  };

  private resetView() {
    this.mode = 'view';
    this.draft.length = 0;
    this.error = null;
  }

  cancel = () => {
    if (this.pending === 'change') return;
    this.resetView();
    this.emit();
  };

  edit = () => {
    if (this.pending || !this.canSave) return;
    this.resetView();
    this.mode = 'edit';
    const entries = this.result?.status === 'ok' ? this.result.entries : [];
    this.draft.push(...entries.map((entry) => ({ id: this.nextRow++, entry })));
    if (!this.draft.length) this.draft.push({ id: this.nextRow++ });
    this.emit();
  };

  addRow = () => {
    if (this.pending || this.draft.length >= BOOK_OUTLINE_MAX_ENTRIES) return;
    this.draft.push({ id: this.nextRow++ });
    this.emit();
  };

  removeRow(index: number) {
    if (this.pending) return;
    this.draft.splice(index, 1);
    this.emit();
  }

  confirmDelete = () => {
    if (this.pending || !this.canSave) return;
    this.resetView();
    this.mode = 'delete';
    this.emit();
  };

  private async change(action: () => Promise<void>) {
    if (this.pending) return;
    this.error = null;
    this.pending = 'change';
    this.emit();
    try {
      await action();
    } catch {
      this.error = 'write';
    } finally {
      this.pending = null;
      this.emit();
    }
  }

  regenerate = () => this.change(async () => {
    const result = await tryReadPdfOutline(this.readPdf);
    if (result.status === 'failed') {
      this.error = result.reason === 'empty' ? 'empty' : 'read';
      return;
    }
    if (!hasOutlineDestination(result.entries)) {
      if (this.result?.status === 'ok') { this.error = 'read'; return; }
    } else if (this.canSave && !await this.storage?.save(result.entries, true)) {
      throw new Error('Outline write failed');
    }
    this.result = { ...result, source: result.source ?? 'pdf' };
  });

  remove = () => this.change(async () => {
    if (!await this.storage?.remove()) throw new Error('Outline deletion failed');
    this.result = { status: 'deleted' };
    this.resetView();
  });

  save(values: FormData, pageCount: number) {
    return this.change(async () => {
      const rows = this.draft.map(({ id }, index) => {
        const page = String(values.get(`page-${id}`) ?? '').trim();
        return {
          key: String(index),
          title: String(values.get(`title-${id}`) ?? '').trim(),
          page: page === '' ? null : Number(page),
          depth: Number(values.get(`level-${id}`)) - 1,
        };
      });
      const entries = parseBookOutlineEntries(rows);
      if (!entries || entries.some(({ title, page }) => !title || (page !== null && page > pageCount))) {
        this.error = 'invalid';
        return;
      }
      if (!await this.storage?.save(entries)) throw new Error('Outline write failed');
      this.result = { status: 'ok', entries, source: 'stored' };
      this.resetView();
    });
  }
}

// Readers are bound to a viewer document. Weak keys let closed viewers be collected.
const models = new WeakMap<OutlineReader, { storage?: PdfOutlineStorage | null; model: OutlineModel }>();

export function getOutlineModel(readPdf: OutlineReader, storage?: PdfOutlineStorage | null): OutlineModel {
  const existing = models.get(readPdf);
  if (existing && existing.storage === storage) return existing.model;
  const model = new OutlineModel(readPdf, storage);
  models.set(readPdf, { storage, model });
  return model;
}
