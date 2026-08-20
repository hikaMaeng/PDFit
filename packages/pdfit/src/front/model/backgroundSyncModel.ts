export type BackgroundSyncStatus = 'pending' | 'syncing' | 'synced' | 'failed';

export interface BackgroundSyncEntry {
  id: string;
  label: string;
  status: BackgroundSyncStatus;
  error?: string;
  retry?: () => void;
}

class BackgroundSyncModel {
  private readonly listeners = new Set<() => void>();
  private entries = new Map<string, BackgroundSyncEntry>();
  private version = 0;

  getSnapshot = () => this.version;
  getEntries = () => [...this.entries.values()];
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };

  begin(label: string, retry?: () => void): string {
    const id = crypto.randomUUID();
    this.entries.set(id, { id, label, status: 'pending', retry });
    this.emit();
    return id;
  }

  syncing(id: string): void { this.update(id, { status: 'syncing', error: undefined }); }

  complete(id: string): void {
    this.update(id, { status: 'synced', error: undefined });
    queueMicrotask(() => { if (this.entries.get(id)?.status === 'synced') { this.entries.delete(id); this.emit(); } });
  }

  fail(id: string, error: string, retry?: () => void): void {
    this.update(id, retry ? { status: 'failed', error, retry } : { status: 'failed', error });
  }

  retry(id: string): void {
    const retry = this.entries.get(id)?.retry;
    if (!retry) return;
    this.entries.delete(id);
    this.emit();
    retry();
  }

  clear(id: string): void { if (this.entries.delete(id)) this.emit(); }

  private update(id: string, patch: Partial<BackgroundSyncEntry>): void {
    const current = this.entries.get(id);
    if (!current) return;
    this.entries.set(id, { ...current, ...patch });
    this.emit();
  }

  private emit(): void { this.version += 1; this.listeners.forEach((listener) => listener()); }
}

export const backgroundSyncModel = new BackgroundSyncModel();
