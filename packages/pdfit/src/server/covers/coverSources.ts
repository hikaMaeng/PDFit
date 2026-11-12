/**
 * Real-book cover lookup. Deterministic: bookstore and catalogue searches plus the
 * same title score the tag lookup uses. No AI model is involved; the user picks one
 * of the returned candidates.
 *
 * Sources:
 *   YES24        public book search page (no key). Its result list already carries
 *                each cover as `image.yes24.com/goods/<id>/L`; `XL` is the large size.
 *   Open Library search.json (no key). `cover_i` maps to covers.openlibrary.org,
 *                which redirects to archive.org.
 */
import { scoreBookTitleMatch } from '../services/tagSuggestion.js';

export type BookCoverSource = 'YES24' | 'Open Library';

export interface BookCoverCandidate {
  source: BookCoverSource;
  title: string;
  authors?: string;
  /** Full-size image. Only hosts accepted by `isAllowedCoverImageUrl` are returned. */
  imageUrl: string;
  /** Product or work page, for the user to check the match. */
  pageUrl: string;
  /** `scoreBookTitleMatch(query, title)`, 0..1. */
  score: number;
}

export interface CoverLookupOptions {
  request?: typeof fetch;
  limitPerSource?: number;
  timeoutMs?: number;
}

const USER_AGENT = 'Mozilla/5.0 (compatible; PDFit; book cover lookup)';
/** Hosts a cover image may be downloaded from, including Open Library's archive.org redirects. */
const ALLOWED_IMAGE_HOSTS = [/^image\.yes24\.com$/i, /^covers\.openlibrary\.org$/i, /^archive\.org$/i, /^[a-z0-9-]+\.us\.archive\.org$/i];

export function isAllowedCoverImageUrl(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  return url.protocol === 'https:' && !url.username && !url.password && (url.port === '' || url.port === '443')
    && ALLOWED_IMAGE_HOSTS.some((pattern) => pattern.test(url.hostname));
}

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ').trim();
}

/** Parses the YES24 public search result page. Exported for tests. */
export function parseYes24CoverCandidates(html: string, query: string, limit: number): BookCoverCandidate[] {
  const result: BookCoverCandidate[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<img\b[^>]*\bdata-original=["']https:\/\/image\.yes24\.com\/goods\/(\d+)\/[A-Z]+["'][^>]*>/gi)) {
    const itemId = match[1];
    if (seen.has(itemId)) continue;
    const title = decodeHtml(/\balt=["']([^"']*)["']/i.exec(match[0])?.[1] ?? '');
    if (!title) continue;
    seen.add(itemId);
    result.push({
      source: 'YES24',
      title,
      imageUrl: `https://image.yes24.com/goods/${itemId}/XL`,
      pageUrl: `https://www.yes24.com/product/goods/${itemId}`,
      score: scoreBookTitleMatch(query, title),
    });
    if (result.length >= limit) break;
  }
  return result;
}

interface OpenLibraryDoc { title?: unknown; author_name?: unknown; cover_i?: unknown; key?: unknown }

/** Parses an Open Library search.json payload. Exported for tests. */
export function parseOpenLibraryCoverCandidates(payload: unknown, query: string, limit: number): BookCoverCandidate[] {
  const docs = (payload as { docs?: OpenLibraryDoc[] } | null)?.docs;
  if (!Array.isArray(docs)) return [];
  const result: BookCoverCandidate[] = [];
  for (const doc of docs) {
    if (typeof doc.title !== 'string' || typeof doc.cover_i !== 'number' || !Number.isInteger(doc.cover_i) || doc.cover_i <= 0) continue;
    const authors = Array.isArray(doc.author_name) ? doc.author_name.filter((name): name is string => typeof name === 'string').slice(0, 3).join(', ') : '';
    const key = typeof doc.key === 'string' && /^\/works\/OL\d+W$/.test(doc.key) ? doc.key : '';
    result.push({
      source: 'Open Library',
      title: doc.title,
      ...(authors ? { authors } : {}),
      imageUrl: `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`,
      pageUrl: key ? `https://openlibrary.org${key}` : `https://openlibrary.org/search?q=${encodeURIComponent(query)}`,
      score: scoreBookTitleMatch(query, doc.title),
    });
    if (result.length >= limit) break;
  }
  return result;
}

/**
 * Searches every source and returns candidates ordered by title score. A source that
 * fails is skipped, so one blocked site does not hide the other's results; the failed
 * sources are reported for the UI.
 */
export async function findBookCoverCandidates(query: string, options: CoverLookupOptions = {}): Promise<{ candidates: BookCoverCandidate[]; failedSources: BookCoverSource[] }> {
  const request = options.request ?? fetch;
  const limit = options.limitPerSource ?? 8;
  const timeoutMs = options.timeoutMs ?? 12_000;
  const trimmed = query.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!trimmed) return { candidates: [], failedSources: [] };

  const yes24 = (async () => {
    const url = new URL('https://www.yes24.com/product/search');
    url.searchParams.set('domain', 'BOOK');
    url.searchParams.set('query', trimmed);
    const response = await request(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`YES24 ${response.status}`);
    return parseYes24CoverCandidates(await response.text(), trimmed, limit);
  })();
  const openLibrary = (async () => {
    const url = new URL('https://openlibrary.org/search.json');
    url.searchParams.set('q', trimmed);
    url.searchParams.set('limit', String(limit * 2));
    url.searchParams.set('fields', 'title,author_name,cover_i,key');
    const response = await request(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`Open Library ${response.status}`);
    return parseOpenLibraryCoverCandidates(await response.json(), trimmed, limit);
  })();

  const settled = await Promise.allSettled([yes24, openLibrary]);
  const sources: BookCoverSource[] = ['YES24', 'Open Library'];
  const candidates: BookCoverCandidate[] = [];
  const failedSources: BookCoverSource[] = [];
  settled.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') candidates.push(...outcome.value);
    else failedSources.push(sources[index]);
  });
  // Stable order: higher title score first; ties keep YES24 before Open Library.
  const ordered = candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => b.candidate.score - a.candidate.score || a.index - b.index)
    .map(({ candidate }) => candidate);
  return { candidates: ordered, failedSources };
}

export const MAX_COVER_IMAGE_BYTES = 8 * 1024 * 1024;

export type CoverImageType = 'image/jpeg' | 'image/png' | 'image/webp';

export function sniffCoverImageType(bytes: Uint8Array): CoverImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Downloads a cover image from an allowed host. Redirects are followed by hand so
 * every hop is checked against the same host list; the body is read up to
 * `MAX_COVER_IMAGE_BYTES` and must be a JPEG, PNG or WebP by its leading bytes.
 * YES24 answers a missing cover with a small placeholder, so images under 1 KB are rejected.
 */
export async function downloadCoverImage(imageUrl: string, options: { request?: typeof fetch; timeoutMs?: number } = {}): Promise<{ bytes: Buffer; type: CoverImageType; finalUrl: string }> {
  const request = options.request ?? fetch;
  let current = imageUrl;
  for (let hop = 0; hop <= 3; hop += 1) {
    if (!isAllowedCoverImageUrl(current)) throw new Error('Cover host is not allowed.');
    const response = await request(current, { headers: { 'User-Agent': USER_AGENT, Accept: 'image/*' }, redirect: 'manual', signal: AbortSignal.timeout(options.timeoutMs ?? 20_000) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`Cover redirect without a location (${response.status}).`);
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`Cover download failed (${response.status}).`);
    const chunks: Buffer[] = [];
    let total = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_COVER_IMAGE_BYTES) { await reader.cancel(); throw new Error('Cover image is too large.'); }
      chunks.push(Buffer.from(value));
    }
    const bytes = Buffer.concat(chunks);
    const type = sniffCoverImageType(bytes);
    if (!type) throw new Error('Cover download is not a JPEG, PNG or WebP image.');
    if (bytes.length < 1024) throw new Error('Cover image is a placeholder.');
    return { bytes, type, finalUrl: current };
  }
  throw new Error('Too many cover redirects.');
}
