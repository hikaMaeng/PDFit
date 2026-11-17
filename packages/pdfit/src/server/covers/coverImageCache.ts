import type { CoverImageType } from './coverSources.js';

/**
 * Downloaded cover candidates kept for a few minutes so choosing one does not download
 * the image a second time after the preview already did.
 *
 * State contract:
 *   key       the candidate image URL (already checked against the allowed hosts)
 *   scope     one cover router in one server process
 *   lifetime  `ttlMs` from the download; an in-flight download is shared until it settles
 *   bound     `maxEntries` images and `maxBytes` in total; the oldest entry is dropped first
 *   cleared   by expiry on read and by eviction on insert; nothing outlives the process
 */
export interface CachedCoverImage { bytes: Buffer; type: CoverImageType; finalUrl: string }

export interface CoverImageCache {
  get(url: string): Promise<CachedCoverImage>;
}

export function createCoverImageCache(
  download: (url: string) => Promise<CachedCoverImage>,
  limits: { maxEntries?: number; maxBytes?: number; ttlMs?: number; now?: () => number } = {},
): CoverImageCache {
  const maxEntries = limits.maxEntries ?? 24;
  const maxBytes = limits.maxBytes ?? 32 * 1024 * 1024;
  const ttlMs = limits.ttlMs ?? 10 * 60 * 1000;
  const now = limits.now ?? Date.now;
  const entries = new Map<string, { image: CachedCoverImage; at: number }>();
  const inflight = new Map<string, Promise<CachedCoverImage>>();
  let total = 0;

  const drop = (url: string) => {
    const entry = entries.get(url);
    if (!entry) return;
    total -= entry.image.bytes.length;
    entries.delete(url);
  };

  return {
    get(url) {
      const hit = entries.get(url);
      if (hit && now() - hit.at < ttlMs) return Promise.resolve(hit.image);
      if (hit) drop(url);
      const pending = inflight.get(url);
      if (pending) return pending;
      const started = download(url).then((image) => {
        if (image.bytes.length <= maxBytes) {
          entries.set(url, { image, at: now() });
          total += image.bytes.length;
          // Map iteration order is insertion order, so the first key is the oldest.
          while (entries.size > maxEntries || total > maxBytes) {
            const oldest = entries.keys().next().value;
            if (oldest === undefined) break;
            drop(oldest);
          }
        }
        return image;
      }).finally(() => { inflight.delete(url); });
      inflight.set(url, started);
      return started;
    },
  };
}
