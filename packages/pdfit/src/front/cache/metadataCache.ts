import type { FolderInfo, PdfInfo } from '../api/folders.js';
import type { BookmarkRecord } from '../../common/protocol/bookmarks/index.js';
import type { ViewerStatePayload } from '../api/viewerState.js';

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

async function cachedScope(): Promise<string | null> { return ensureHydrated(); }

async function mutateStores(scope: string, stores: string[], action: (transaction: IDBTransaction) => Promise<void>): Promise<void> {
  const database = await openDatabase(scope);
  try { const transaction = database.transaction(stores, 'readwrite'); await action(transaction); await transactionDone(transaction); }
  finally { database.close(); }
}

async function cachedFile(scope: string, folderName: string, filename: string): Promise<CachedPdfRow | null> {
  const [folders, pdfs] = await Promise.all([readAll<CachedFolderRow>(scope, 'folders'), readAll<CachedPdfRow>(scope, 'pdfs')]);
  const folder = folders.find((row) => !row.trashed && row.name === folderName);
  return pdfs.find((row) => !row.trashed && row.parentFolderId === folder?.driveFolderId && row.name === filename) ?? null;
}

type CachedTag = { tagId: string; name: string; color: string; createdAt: string; updatedAt: string; deletedAt: string };
type CachedRelation = { relationId: string; driveFileId: string; tagId: string; createdAt: string; updatedAt: string; deletedAt: string };

export async function listCachedTagSummaries(): Promise<Array<{ name: string; bookCount: number; color: string }> | null> {
  const scope = await cachedScope(); if (!scope) return null;
  const [tags, relations] = await Promise.all([readAll<CachedTag>(scope, 'tags'), readAll<CachedRelation>(scope, 'pdfTags')]);
  return tags.filter((tag) => !tag.deletedAt).map((tag) => ({ name: tag.name, color: tag.color, bookCount: new Set(relations.filter((row) => !row.deletedAt && row.tagId === tag.tagId).map((row) => row.driveFileId)).size }));
}

export async function listCachedBookTags(folder: string, filename: string): Promise<string[] | null> {
  const scope = await cachedScope(); if (!scope) return null;
  const file = await cachedFile(scope, folder, filename); if (!file) return [];
  const [tags, relations] = await Promise.all([readAll<CachedTag>(scope, 'tags'), readAll<CachedRelation>(scope, 'pdfTags')]);
  const ids = new Set(relations.filter((row) => row.driveFileId === file.driveFileId && !row.deletedAt).map((row) => row.tagId));
  return tags.filter((tag) => ids.has(tag.tagId) && !tag.deletedAt).map((tag) => tag.name).sort();
}

export async function listCachedFolderTags(folder: string): Promise<Record<string, string[]> | null> {
  const scope = await cachedScope(); if (!scope) return null;
  const files = await listCachedFiles(folder) ?? []; const result: Record<string, string[]> = {};
  for (const file of files) result[file.name] = await listCachedBookTags(folder, file.name) ?? [];
  return result;
}

export async function mutateCachedTag(folder: string, filename: string, name: string, deleted: boolean): Promise<void> {
  const scope = await cachedScope(); if (!scope) return;
  const file = await cachedFile(scope, folder, filename); if (!file) return;
  await mutateStores(scope, ['tags', 'pdfTags'], async (transaction) => {
    const tags = await requestResult<CachedTag[]>(transaction.objectStore('tags').getAll());
    const existing = tags.find((tag) => tag.name === name); const timestamp = new Date().toISOString();
    const tag = existing ?? { tagId: crypto.randomUUID(), name, color: '#3b82f6', createdAt: timestamp, updatedAt: timestamp, deletedAt: '' };
    transaction.objectStore('tags').put({ ...tag, deletedAt: '' });
    const relations = await requestResult<CachedRelation[]>(transaction.objectStore('pdfTags').getAll());
    const relation = relations.find((row) => row.driveFileId === file.driveFileId && row.tagId === tag.tagId);
    transaction.objectStore('pdfTags').put({ relationId: relation?.relationId ?? crypto.randomUUID(), driveFileId: file.driveFileId, tagId: tag.tagId, createdAt: relation?.createdAt ?? timestamp, updatedAt: timestamp, deletedAt: deleted ? timestamp : '' });
  });
}

export async function deleteCachedTag(name: string): Promise<void> {
  const scope = await cachedScope(); if (!scope) return;
  await mutateStores(scope, ['tags'], async (transaction) => { const store = transaction.objectStore('tags'); const tags = await requestResult<CachedTag[]>(store.getAll()); const tag = tags.find((row) => row.name === name); if (tag) store.put({ ...tag, deletedAt: new Date().toISOString() }); });
}

export async function updateCachedTagColor(name: string, color: string): Promise<void> {
  const scope = await cachedScope(); if (!scope) return;
  await mutateStores(scope, ['tags'], async (transaction) => { const store = transaction.objectStore('tags'); const tags = await requestResult<CachedTag[]>(store.getAll()); const tag = tags.find((row) => row.name === name); if (tag) store.put({ ...tag, color, updatedAt: new Date().toISOString(), deletedAt: '' }); });
}

export async function getCachedProgress(folder: string, filename: string): Promise<number | null> { const scope = await cachedScope(); if (!scope) return null; const file = await cachedFile(scope, folder, filename); if (!file) return 1; const rows = await readAll<{ driveFileId: string; lastPage: number }>(scope, 'progress'); return rows.find((row) => row.driveFileId === file.driveFileId)?.lastPage ?? 1; }
export async function saveCachedProgress(folder: string, filename: string, page: number): Promise<void> { const scope = await cachedScope(); if (!scope) return; const file = await cachedFile(scope, folder, filename); if (!file) return; await mutateStores(scope, ['progress'], async (transaction) => { transaction.objectStore('progress').put({ driveFileId: file.driveFileId, lastPage: page, updatedAt: new Date().toISOString() }); }); }
export async function getCachedViewerState(folder: string, filename: string): Promise<ViewerStatePayload | null | undefined> { const scope = await cachedScope(); if (!scope) return undefined; const file = await cachedFile(scope, folder, filename); if (!file) return null; const rows = await readAll<ViewerStatePayload & { driveFileId: string }>(scope, 'viewerStates'); const row = rows.find((value) => value.driveFileId === file.driveFileId); if (!row) return null; const { driveFileId: _, ...state } = row; return state; }
export async function saveCachedViewerState(folder: string, filename: string, state: ViewerStatePayload): Promise<void> { const scope = await cachedScope(); if (!scope) return; const file = await cachedFile(scope, folder, filename); if (!file) return; await mutateStores(scope, ['viewerStates'], async (transaction) => { transaction.objectStore('viewerStates').put({ driveFileId: file.driveFileId, ...state, updatedAt: new Date().toISOString() }); }); }

type CachedBookmark = Record<string, unknown> & { bookmarkId: string; driveFileId: string; deletedAt: string };
export async function listCachedBookmarks(folder?: string, filename?: string): Promise<BookmarkRecord[] | null> {
  const scope = await cachedScope(); if (!scope) return null;
  const [rows, pdfs, folders] = await Promise.all([readAll<CachedBookmark>(scope, 'bookmarks'), readAll<CachedPdfRow>(scope, 'pdfs'), readAll<CachedFolderRow>(scope, 'folders')]);
  const result: BookmarkRecord[] = [];
  for (const row of rows) {
    if (row.deletedAt) continue;
    const pdf = pdfs.find((value) => value.driveFileId === row.driveFileId); const parent = folders.find((value) => value.driveFolderId === pdf?.parentFolderId);
    if (!pdf || !parent || (folder && parent.name !== folder) || (filename && pdf.name !== filename)) continue;
    result.push({ id: row.bookmarkId, folder: parent.name, filename: pdf.name, pageIndex: Number(row.pageIndex), rect: { x: Number(row.x), y: Number(row.y), width: Number(row.width), height: Number(row.height) }, borderColor: String(row.borderColor), fillColor: row.fillColor ? String(row.fillColor) : null, fillOpacity: Number(row.fillOpacity), comment: row.memo ? String(row.memo) : null, imageMimeType: String(row.imageMimeType || 'image/jpeg') as BookmarkRecord['imageMimeType'], imageUrl: `/api/bookmark-assets/${encodeURIComponent(row.bookmarkId)}`, createdAt: String(row.createdAt), updatedAt: String(row.updatedAt) });
  }
  return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function cacheBookmarkRecord(record: BookmarkRecord): Promise<void> { const scope = await cachedScope(); if (!scope) return; const file = await cachedFile(scope, record.folder, record.filename); if (!file) return; await mutateStores(scope, ['bookmarks'], async (transaction) => { transaction.objectStore('bookmarks').put({ bookmarkId: record.id, driveFileId: file.driveFileId, pageIndex: record.pageIndex, x: record.rect.x, y: record.rect.y, width: record.rect.width, height: record.rect.height, borderColor: record.borderColor, fillColor: record.fillColor ?? '', fillOpacity: record.fillOpacity, memo: record.comment ?? '', imageDriveId: '', imageMimeType: record.imageMimeType, createdAt: record.createdAt, updatedAt: record.updatedAt, deletedAt: '' }); }); }
export async function deleteCachedBookmark(id: string): Promise<void> { const scope = await cachedScope(); if (!scope) return; await mutateStores(scope, ['bookmarks'], async (transaction) => { const store = transaction.objectStore('bookmarks'); const row = await requestResult<CachedBookmark | undefined>(store.get(id)); if (row) store.put({ ...row, deletedAt: new Date().toISOString() }); }); }

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
    .map((pdf) => ({ name: pdf.name, size: pdf.size, modifiedAt: pdf.modifiedTime || pdf.createdTime, driveFileId: pdf.driveFileId }));
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

/** Replaces optimistic metadata with the current remote snapshot after outbox settlement. */
export async function refreshPdfitMetadataCache(): Promise<void> {
  await invalidatePdfitMetadataCache();
  await ensureHydrated();
}
