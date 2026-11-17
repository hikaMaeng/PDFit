import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CoverImageType } from './coverSources.js';

/**
 * Downloaded cover candidates, kept so choosing one never downloads the image again:
 * the preview already brought it to the server.
 *
 * With `dir` the images are files (`<sha1(url)>.<jpg|png|webp>`), so they survive a restart
 * and the server's memory holds none of them. Without `dir` they stay in memory (tests,
 * hosted runtimes without a data volume).
 *
 * State contract:
 *   key       the candidate image URL (already checked against the allowed hosts)
 *   scope     one cover router; `dir` is private to it
 *   lifetime  `ttlMs` from the download (file modification time); an in-flight download is
 *             shared until it settles
 *   bound     `maxEntries` images and `maxBytes` in total; the oldest is dropped first
 *   cleared   by `prune`, run after every download and once at creation; a file that cannot
 *             be read counts as missing and is downloaded again
 */
export interface CachedCoverImage { bytes: Buffer; type: CoverImageType; finalUrl: string }

export interface CoverImageCache {
  get(url: string): Promise<CachedCoverImage>;
}

const EXTENSION: Record<CoverImageType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const TYPE_OF: Record<string, CoverImageType> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const FILE_NAME = /^[0-9a-f]{40}\.(jpg|png|webp)$/;

export function createCoverImageCache(
  download: (url: string) => Promise<CachedCoverImage>,
  limits: { dir?: string; maxEntries?: number; maxBytes?: number; ttlMs?: number; now?: () => number } = {},
): CoverImageCache {
  const maxEntries = limits.maxEntries ?? 200;
  const maxBytes = limits.maxBytes ?? 128 * 1024 * 1024;
  const ttlMs = limits.ttlMs ?? 60 * 60 * 1000;
  const now = limits.now ?? Date.now;
  const dir = limits.dir ? path.resolve(limits.dir) : null;
  const inflight = new Map<string, Promise<CachedCoverImage>>();

  // Memory mode. Insertion order is age order, so the first key is the oldest.
  const memory = new Map<string, { image: CachedCoverImage; at: number }>();
  let memoryBytes = 0;
  const dropMemory = (url: string) => {
    const entry = memory.get(url);
    if (!entry) return;
    memoryBytes -= entry.image.bytes.length;
    memory.delete(url);
  };

  const hashOf = (url: string) => createHash('sha1').update(url).digest('hex');

  async function prune(): Promise<void> {
    if (!dir) return;
    let names: string[];
    try { names = (await fs.readdir(dir)).filter((name) => FILE_NAME.test(name)); } catch { return; }
    const files: Array<{ name: string; mtimeMs: number; size: number }> = [];
    for (const name of names) {
      try { const stat = await fs.stat(path.join(dir, name)); files.push({ name, mtimeMs: stat.mtimeMs, size: stat.size }); } catch { /* removed meanwhile */ }
    }
    files.sort((left, right) => left.mtimeMs - right.mtimeMs);
    let total = files.reduce((sum, file) => sum + file.size, 0);
    let count = files.length;
    for (const file of files) {
      if (now() - file.mtimeMs < ttlMs && count <= maxEntries && total <= maxBytes) break;
      await fs.rm(path.join(dir, file.name), { force: true });
      count -= 1; total -= file.size;
    }
  }
  void prune();

  async function readFromDisk(url: string): Promise<CachedCoverImage | null> {
    if (!dir) return null;
    const hash = hashOf(url);
    for (const extension of Object.keys(TYPE_OF)) {
      const file = path.join(dir, `${hash}.${extension}`);
      try {
        const stat = await fs.stat(file);
        if (now() - stat.mtimeMs >= ttlMs) continue;
        return { bytes: await fs.readFile(file), type: TYPE_OF[extension], finalUrl: url };
      } catch { /* not staged under this extension */ }
    }
    return null;
  }

  async function writeToDisk(url: string, image: CachedCoverImage): Promise<void> {
    if (!dir || image.bytes.length > maxBytes) return;
    try {
      await fs.mkdir(dir, { recursive: true });
      const target = path.join(dir, `${hashOf(url)}.${EXTENSION[image.type]}`);
      const temporary = `${target}.${process.pid}.tmp`;
      await fs.writeFile(temporary, image.bytes);
      await fs.rename(temporary, target);
      void prune();
    } catch { /* staging is an optimisation: the image is still served from the download */ }
  }

  async function load(url: string): Promise<CachedCoverImage> {
    if (dir) {
      const staged = await readFromDisk(url);
      if (staged) return staged;
    } else {
      const hit = memory.get(url);
      if (hit && now() - hit.at < ttlMs) return hit.image;
      if (hit) dropMemory(url);
    }
    const image = await download(url);
    if (dir) await writeToDisk(url, image);
    else if (image.bytes.length <= maxBytes) {
      memory.set(url, { image, at: now() });
      memoryBytes += image.bytes.length;
      while (memory.size > maxEntries || memoryBytes > maxBytes) {
        const oldest = memory.keys().next().value;
        if (oldest === undefined) break;
        dropMemory(oldest);
      }
    }
    return image;
  }

  return {
    get(url) {
      const pending = inflight.get(url);
      if (pending) return pending;
      const started = load(url).finally(() => { inflight.delete(url); });
      inflight.set(url, started);
      return started;
    },
  };
}
