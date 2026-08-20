import type { FolderInfo, PdfInfo } from '../api/folders.js';

export const PDFIT_METADATA_CACHE_SCHEMA_VERSION = '1';

export interface CachedFolderRow {
  driveFolderId: string; parentFolderId: string; name: string; color: string;
  isRoot: boolean; trashed: boolean; createdAt: string; updatedAt: string;
}
export interface CachedPdfRow {
  driveFileId: string; parentFolderId: string; name: string; mimeType: string;
  size: number; md5Checksum: string; driveVersion: string; createdTime: string;
  modifiedTime: string; trashed: boolean; updatedAt: string;
}

export interface PdfitMetadataCacheSnapshot {
  system: Array<Record<string, unknown>>;
  folders: CachedFolderRow[];
  pdfs: CachedPdfRow[];
  tags: Array<Record<string, unknown>>;
  pdf_tags: Array<Record<string, unknown>>;
  bookmarks: Array<Record<string, unknown>>;
  reading_progress: Array<Record<string, unknown>>;
  viewer_state: Array<Record<string, unknown>>;
  sync_state: Array<Record<string, unknown>>;
}

export interface PdfitMetadataBootstrap {
  libraryInstanceId: string;
  schemaVersion: string;
  hydratedAt: string;
  snapshot: PdfitMetadataCacheSnapshot;
}

export interface PdfitMetadataCacheOptions {
  scope: () => string;
  bootstrapUrl?: string;
}

const STORE_DEFINITIONS = {
  meta: 'key', folders: 'driveFolderId', pdfs: 'driveFileId', tags: 'tagId',
  pdfTags: 'relationId', bookmarks: 'bookmarkId', progress: 'driveFileId',
  viewerStates: 'driveFileId', syncState: 'key',
} as const;

let options: PdfitMetadataCacheOptions | null = null;
const hydrationRequests = new Map<string, Promise<void>>();

export function configurePdfitMetadataCache(value?: PdfitMetadataCacheOptions): void {
  options = value ?? null;
}

function databaseName(scope: string): string {
  return `pdfit-metadata-${encodeURIComponent(scope)}`;
}

function openDatabase(scope: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName(scope), 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const [name, keyPath] of Object.entries(STORE_DEFINITIONS)) {
        if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed.'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
  });
}

async function isHydrated(scope: string): Promise<boolean> {
  const database = await openDatabase(scope);
  try {
    const transaction = database.transaction('meta', 'readonly');
    const row = await requestResult<{ key: string; schemaVersion: string } | undefined>(transaction.objectStore('meta').get('hydration'));
    return row?.schemaVersion === PDFIT_METADATA_CACHE_SCHEMA_VERSION;
  } finally { database.close(); }
}

async function replaceSnapshot(scope: string, bootstrap: PdfitMetadataBootstrap): Promise<void> {
  if (bootstrap.schemaVersion !== PDFIT_METADATA_CACHE_SCHEMA_VERSION) throw new Error(`Unsupported metadata cache schema ${bootstrap.schemaVersion}.`);
  const database = await openDatabase(scope);
  const names = Object.keys(STORE_DEFINITIONS);
  try {
    const transaction = database.transaction(names, 'readwrite');
    const rows = {
      folders: bootstrap.snapshot.folders, pdfs: bootstrap.snapshot.pdfs,
      tags: bootstrap.snapshot.tags, pdfTags: bootstrap.snapshot.pdf_tags,
      bookmarks: bootstrap.snapshot.bookmarks, progress: bootstrap.snapshot.reading_progress,
      viewerStates: bootstrap.snapshot.viewer_state, syncState: bootstrap.snapshot.sync_state,
    };
    for (const [storeName, values] of Object.entries(rows)) {
      const store = transaction.objectStore(storeName);
      store.clear();
      for (const value of values) store.put(value);
    }
    const meta = transaction.objectStore('meta');
    meta.clear();
    for (const value of bootstrap.snapshot.system) meta.put(value);
    meta.put({ key: 'hydration', schemaVersion: bootstrap.schemaVersion, libraryInstanceId: bootstrap.libraryInstanceId, hydratedAt: bootstrap.hydratedAt });
    await transactionDone(transaction);
  } finally { database.close(); }
}

async function ensureHydrated(): Promise<string | null> {
  if (!options || typeof indexedDB === 'undefined') return null;
  const scope = options.scope();
  if (!scope) return null;
  if (await isHydrated(scope)) return scope;
  let pending = hydrationRequests.get(scope);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(options?.bootstrapUrl ?? '/api/folders/cache');
      const body = await response.json() as PdfitMetadataBootstrap & { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Metadata hydration failed.');
      await replaceSnapshot(scope, body);
    })().finally(() => hydrationRequests.delete(scope));
    hydrationRequests.set(scope, pending);
  }
  await pending;
  return scope;
}

async function readAll<T>(scope: string, storeName: string): Promise<T[]> {
  const database = await openDatabase(scope);
  try {
    const transaction = database.transaction(storeName, 'readonly');
    return await requestResult<T[]>(transaction.objectStore(storeName).getAll());
  } finally { database.close(); }
}

export async function listCachedFolders(): Promise<FolderInfo[] | null> {
  const scope = await ensureHydrated();
  if (!scope) return null;
  const [folders, pdfs] = await Promise.all([readAll<CachedFolderRow>(scope, 'folders'), readAll<CachedPdfRow>(scope, 'pdfs')]);
  const counts = new Map<string, number>();
  for (const pdf of pdfs) if (!pdf.trashed) counts.set(pdf.parentFolderId, (counts.get(pdf.parentFolderId) ?? 0) + 1);
  return folders.filter((folder) => !folder.trashed).map((folder) => ({
    name: folder.name, pdfCount: counts.get(folder.driveFolderId) ?? 0,
    createdAt: folder.createdAt, isRoot: folder.isRoot, color: folder.color || '#3b82f6',
  }));
}

export async function listCachedFiles(folderName: string): Promise<PdfInfo[] | null> {
  const scope = await ensureHydrated();
  if (!scope) return null;
  const [folders, pdfs] = await Promise.all([readAll<CachedFolderRow>(scope, 'folders'), readAll<CachedPdfRow>(scope, 'pdfs')]);
  const folder = folders.find((row) => !row.trashed && row.name === folderName);
  if (!folder) return [];
  return pdfs.filter((pdf) => !pdf.trashed && pdf.parentFolderId === folder.driveFolderId)
    .map((pdf) => ({ name: pdf.name, size: pdf.size, modifiedAt: pdf.modifiedTime || pdf.createdTime }));
}

export async function invalidatePdfitMetadataCache(): Promise<void> {
  if (!options || typeof indexedDB === 'undefined') return;
  const scope = options.scope();
  if (!scope) return;
  hydrationRequests.delete(scope);
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName(scope));
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('IndexedDB delete failed.'));
    request.onblocked = () => reject(new Error('IndexedDB delete was blocked.'));
  });
}
