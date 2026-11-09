import { uiText } from '../i18n/uiText.js';
import { pdfitMetadataScope } from '../cache/metadataCache.js';
export interface BookMetadataRecord {
  driveFileId: string;
  documentType?: 'document' | 'book';
  title: string;
  subtitle: string;
  authors: string[];
  translator: string;
  publisher: string;
  publishedDate: string;
  isbn: string;
  language: string;
  subjects: string[];
  description: string;
  summary: string;
  tableOfContents: string;
  coverUrl: string;
  sources: Array<{ title: string; url: string }>;
  provenance: 'manual' | 'ai';
  updatedAt: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: response.statusText })) as { error?: string; detail?: string };
    throw new Error(payload.detail || payload.error || uiText("요청에 실패했습니다 ({p0}).", { p0: response.status }));
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

const path = (driveFileId: string) => `/api/books/${encodeURIComponent(driveFileId)}`;
const METADATA_CACHE_MS = 30_000;
const METADATA_CACHE_LIMIT = 32;
const metadataRequests = new Map<string, { expiresAt: number; promise: Promise<BookMetadataRecord | null> }>();
const metadataKey = (driveFileId: string) => `${pdfitMetadataScope()}\0${driveFileId}`;

function rememberMetadata(key: string, promise: Promise<BookMetadataRecord | null>): Promise<BookMetadataRecord | null> {
  metadataRequests.delete(key);
  metadataRequests.set(key, { expiresAt: Date.now() + METADATA_CACHE_MS, promise });
  while (metadataRequests.size > METADATA_CACHE_LIMIT) metadataRequests.delete(metadataRequests.keys().next().value!);
  void promise.catch(() => { if (metadataRequests.get(key)?.promise === promise) metadataRequests.delete(key); });
  return promise;
}

function getMetadata(driveFileId: string): Promise<BookMetadataRecord | null> {
  const key = metadataKey(driveFileId);
  const cached = metadataRequests.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  return rememberMetadata(key, request<BookMetadataRecord | null>(`${path(driveFileId)}/metadata`));
}

export const bookMetadataApi = {
  get: getMetadata,
  prefetch: (driveFileId: string) => { void getMetadata(driveFileId).catch(() => undefined); },
  save: async (driveFileId: string, metadata: BookMetadataRecord) => {
    const saved = await request<BookMetadataRecord>(`${path(driveFileId)}/metadata`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(metadata) });
    rememberMetadata(metadataKey(driveFileId), Promise.resolve(saved));
    return saved;
  },
  research: (driveFileId: string, title: string, signal?: AbortSignal) => request<BookMetadataRecord>(`${path(driveFileId)}/research`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }), signal }),
  autoCover: (driveFileId: string, title: string, coverUrl: string, signal?: AbortSignal) => request<{ applied: boolean; reason?: string }>(`${path(driveFileId)}/auto-cover`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, coverUrl }), signal }),
  lookupCover: (driveFileId: string, signal?: AbortSignal) => request<{ applied: boolean; reason?: string }>(`${path(driveFileId)}/auto-cover/lookup`, { method: 'POST', signal }),
};

const pendingCoverLookups: string[] = [];
const coverLookupListeners = new Map<string, Set<() => void>>();
let activeCoverLookups = 0;

function pumpCoverLookups(): void {
  while (activeCoverLookups < 2 && pendingCoverLookups.length > 0) {
    const driveFileId = pendingCoverLookups.shift()!;
    activeCoverLookups += 1;
    void bookMetadataApi.lookupCover(driveFileId)
      .then(({ applied }) => { if (applied) coverLookupListeners.get(driveFileId)?.forEach((listener) => listener()); })
      .catch(() => undefined)
      .finally(() => { coverLookupListeners.delete(driveFileId); activeCoverLookups -= 1; pumpCoverLookups(); });
  }
}

/** Runs paid automatic lookups only for cover cards that enter the viewport. */
export function queueAutomaticCoverLookup(driveFileId: string, onApplied: () => void): void {
  const listeners = coverLookupListeners.get(driveFileId);
  if (listeners) { listeners.add(onApplied); return; }
  coverLookupListeners.set(driveFileId, new Set([onApplied]));
  pendingCoverLookups.push(driveFileId);
  pumpCoverLookups();
}
