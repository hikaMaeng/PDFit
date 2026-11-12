/**
 * Real-book covers (local libraries). The server stores the image; this module keeps
 * the version of every replaced cover so a card can put it in its thumbnail URL as `c`.
 * The rendered thumbnail is cached for good under its `v` URL, so a new URL is the only
 * way a browser that already holds the old cover shows the new one.
 *
 * State: `versions` is keyed by folder + NUL + filename, holds one short version per
 * replaced cover, lives for the page session, is bounded by the number of replaced
 * covers in the library, and is replaced wholesale by `loadCoverOverrides`.
 */
export type BookCoverSource = 'YES24' | 'Open Library';

export interface BookCoverCandidate {
  source: BookCoverSource;
  title: string;
  authors?: string;
  imageUrl: string;
  pageUrl: string;
  score: number;
}

interface CoverOverrideSummary { folder: string; filename: string; version: string; source: BookCoverSource; title: string }

const key = (folder: string, filename: string) => `${folder}\u0000${filename}`;
let versions = new Map<string, string>();
/**
 * null until a load gives a definite answer; false only when the server has no cover
 * API (404 or a response that is not the cover list, as on the hosted runtime). A
 * network error or 5xx keeps it null, so the next card or tab return asks again.
 */
let available: boolean | null = null;
let lastFailureAt = 0;
const RETRY_AFTER_FAILURE_MS = 5_000;
let revision = 0;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const notify = () => { revision += 1; for (const listener of listeners) listener(); };

export function subscribeCovers(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getCoversRevision(): number {
  return revision;
}

export function coversAvailable(): boolean {
  return available === true;
}

export function coverVersion(folder: string, filename: string): string | undefined {
  return versions.get(key(folder, filename));
}

/** Adds the replaced-cover version to a local thumbnail URL, or returns it unchanged. */
export function withCoverVersion(thumbnailUrl: string, folder: string, filename: string): string {
  const version = coverVersion(folder, filename);
  return version ? `${thumbnailUrl}${thumbnailUrl.includes('?') ? '&' : '?'}c=${encodeURIComponent(version)}` : thumbnailUrl;
}

export function loadCoverOverrides(): Promise<void> {
  loading ??= (async () => {
    try {
      const response = await fetch('/api/covers', { cache: 'no-store' });
      if (response.status >= 500) { lastFailureAt = Date.now(); return; }
      const payload = response.ok ? await response.json().catch(() => null) as { overrides?: CoverOverrideSummary[] } | null : null;
      if (!payload || !Array.isArray(payload.overrides)) {
        if (available === null) { available = false; notify(); }
        return;
      }
      versions = new Map(payload.overrides.map((item) => [key(item.folder, item.filename), item.version]));
      available = true;
      notify();
    } catch {
      // Offline, aborted, or refused by the browser: not an answer about the server.
      lastFailureAt = Date.now();
    } finally {
      loading = null;
    }
  })();
  return loading;
}

let refreshOnVisible = false;
/**
 * Loads the replaced-cover versions once per page and again whenever the tab becomes
 * visible, so a cover replaced in another tab or on another device shows up on return.
 */
export function ensureCoverOverrides(): void {
  if (!refreshOnVisible && typeof document !== 'undefined') {
    refreshOnVisible = true;
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && available !== false) void loadCoverOverrides(); });
  }
  if (available === null && !loading && Date.now() - lastFailureAt >= RETRY_AFTER_FAILURE_MS) void loadCoverOverrides();
}

async function errorText(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  return payload?.error ?? `HTTP ${response.status}`;
}

export async function findCoverCandidates(query: string, signal?: AbortSignal): Promise<{ candidates: BookCoverCandidate[]; failedSources: BookCoverSource[] }> {
  const response = await fetch(`/api/covers/candidates?q=${encodeURIComponent(query)}`, { signal });
  if (!response.ok) throw new Error(await errorText(response));
  return response.json() as Promise<{ candidates: BookCoverCandidate[]; failedSources: BookCoverSource[] }>;
}

/** Candidate image through the server, which accepts only the cover hosts. */
export function coverPreviewUrl(imageUrl: string): string {
  return `/api/covers/preview?url=${encodeURIComponent(imageUrl)}`;
}

export async function applyCover(folder: string, filename: string, candidate: BookCoverCandidate): Promise<string> {
  const response = await fetch('/api/covers', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder, filename, imageUrl: candidate.imageUrl, source: candidate.source, title: candidate.title, pageUrl: candidate.pageUrl }),
  });
  if (!response.ok) throw new Error(await errorText(response));
  const record = await response.json() as CoverOverrideSummary;
  versions = new Map(versions).set(key(folder, filename), record.version);
  notify();
  return record.version;
}

export async function restoreCover(folder: string, filename: string): Promise<void> {
  const response = await fetch(`/api/covers?folder=${encodeURIComponent(folder)}&filename=${encodeURIComponent(filename)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(await errorText(response));
  const next = new Map(versions);
  next.delete(key(folder, filename));
  versions = next;
  notify();
}

/** Search text for a PDF filename: extension, underscores and edition brackets removed. */
export function coverQueryFromFilename(filename: string): string {
  return filename
    .normalize('NFC')
    .replace(/\.pdf$/i, '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}
