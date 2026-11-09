export interface MetadataOutboxOptions { scope: () => string; onFlushed?: () => void | Promise<void> }
export interface MetadataOutboxRequest { operationId?: string; coalesceKey?: string; url: string; method: string; headers?: Record<string, string>; body?: string }
interface OutboxRow extends MetadataOutboxRequest { id: string; operationId: string; createdAt: string; attempts: number }

let options: MetadataOutboxOptions | null = null;
let flushing: Promise<void> | null = null;
let listenerInstalled = false;

function dbName(scope: string) { return `pdfit-metadata-outbox-${encodeURIComponent(scope)}`; }
function open(scope: string): Promise<IDBDatabase> { return new Promise((resolve, reject) => { const request = indexedDB.open(dbName(scope), 1); request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('operations')) request.result.createObjectStore('operations', { keyPath: 'id' }); }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
function done(transaction: IDBTransaction): Promise<void> { return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); }); }
async function put(scope: string, row: OutboxRow) { const db = await open(scope); try { const tx = db.transaction('operations', 'readwrite'); tx.objectStore('operations').put(row); await done(tx); } finally { db.close(); } }
async function rows(scope: string): Promise<OutboxRow[]> { const db = await open(scope); try { const tx = db.transaction('operations', 'readonly'); return await new Promise((resolve, reject) => { const request = tx.objectStore('operations').getAll(); request.onsuccess = () => resolve(request.result as OutboxRow[]); request.onerror = () => reject(request.error); }); } finally { db.close(); } }
async function remove(scope: string, id: string, operationId: string) { const db = await open(scope); try { const tx = db.transaction('operations', 'readwrite'); const store = tx.objectStore('operations'); const current = await new Promise<OutboxRow | undefined>((resolve, reject) => { const request = store.get(id); request.onsuccess = () => resolve(request.result as OutboxRow | undefined); request.onerror = () => reject(request.error); }); if (current?.operationId === operationId) store.delete(id); await done(tx); } finally { db.close(); } }

export function configureMetadataOutbox(value?: MetadataOutboxOptions) {
  options = value ?? null;
  if (!listenerInstalled && typeof window !== 'undefined') { listenerInstalled = true; window.addEventListener('online', () => { void flushMetadataOutbox(); }); }
  void flushMetadataOutbox();
  if (typeof window !== 'undefined') window.setTimeout(() => { void flushMetadataOutbox(); }, 1000);
}

export async function requestWithMetadataOutbox(input: MetadataOutboxRequest): Promise<Response> {
  const scope = options?.scope() ?? '';
  if (!scope || typeof indexedDB === 'undefined') return fetch(input.url, { method: input.method, headers: input.headers, body: input.body });
  const operationId = input.operationId ?? crypto.randomUUID();
  const row: OutboxRow = { ...input, id: input.coalesceKey ?? operationId, operationId, createdAt: new Date().toISOString(), attempts: 0 };
  await put(scope, row);
  try {
    const response = await fetch(row.url, { method: row.method, headers: row.headers, body: row.body });
    if (response.ok || response.status < 500) {
      await remove(scope, row.id, row.operationId);
      if (!response.ok) await options?.onFlushed?.();
    }
    return response;
  } catch (error) { throw error; }
}

export function flushMetadataOutbox(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    const scope = options?.scope() ?? '';
    if (!scope || typeof indexedDB === 'undefined' || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
    let changed = false;
    for (const row of (await rows(scope)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      try {
        const response = await fetch(row.url, { method: row.method, headers: row.headers, body: row.body });
        if (!response.ok && response.status >= 500) break;
        await remove(scope, row.id, row.operationId); changed = true;
      } catch { break; }
    }
    if (changed) await options?.onFlushed?.();
  })().finally(() => { flushing = null; });
  return flushing;
}
