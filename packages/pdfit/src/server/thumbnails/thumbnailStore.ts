import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/** Bump to re-render every thumbnail, for example after changing the renderer or the size. */
export const THUMBNAIL_FORMAT_VERSION = 1;
export const THUMBNAIL_WIDTH = 360;
export const THUMBNAIL_JPEG_QUALITY = 82;
/** A recorded failure is retried after this long, so a transient read error does not stick forever. */
export const THUMBNAIL_FAILURE_RETRY_MS = 24 * 60 * 60 * 1000;

const NAME_PATTERN = /^([0-9a-f]{40})\.(\d{1,16}-\d{1,16})\.v(\d+)\.(jpg|failed)$/;
const TEMP_PATTERN = /\.tmp$/;
const STAMP_PATTERN = /^\d{1,16}-\d{1,16}$/;

export type ThumbnailFileKind = 'jpg' | 'failed';

export interface ThumbnailStoreEntry {
  name: string;
  hash: string;
  stamp: string;
  version: number;
  kind: ThumbnailFileKind;
}

/**
 * A thumbnail is valid for exactly one source state. The stamp is the source's
 * modification time in whole milliseconds plus its size, so a changed file has no
 * thumbnail under its new stamp and is picked up by the next plan.
 */
export function thumbnailSourceStamp(modifiedAtMs: number, size: number): string {
  return `${Math.trunc(modifiedAtMs)}-${Math.trunc(size)}`;
}

export function isThumbnailStamp(value: unknown): value is string {
  return typeof value === 'string' && STAMP_PATTERN.test(value);
}

export function thumbnailIdentityHash(folder: string, filename: string): string {
  return createHash('sha1').update(`${folder}\u0000${filename}`).digest('hex');
}

export function thumbnailFileName(folder: string, filename: string, stamp: string, kind: ThumbnailFileKind): string {
  return `${thumbnailIdentityHash(folder, filename)}.${stamp}.v${THUMBNAIL_FORMAT_VERSION}.${kind}`;
}

export function parseThumbnailFileName(name: string): ThumbnailStoreEntry | null {
  const match = NAME_PATTERN.exec(name);
  if (!match) return null;
  return { name, hash: match[1], stamp: match[2], version: Number(match[3]), kind: match[4] as ThumbnailFileKind };
}

export interface ThumbnailStore {
  readonly root: string;
  ensureRoot(): Promise<void>;
  pathOf(name: string): string;
  imagePath(folder: string, filename: string, stamp: string): string;
  exists(name: string): Promise<boolean>;
  /** Thumbnail and failure-marker files by name. Files this store did not create are not listed. */
  list(): Promise<Map<string, { mtimeMs: number | null }>>;
  /** Names of interrupted writes older than `olderThanMs`. */
  listStaleTemporaryFiles(olderThanMs: number, now: number): Promise<string[]>;
  remove(names: string[]): Promise<number>;
  writeFailure(folder: string, filename: string, stamp: string, detail: { code: string; message: string }): Promise<void>;
}

/** File-backed thumbnail store rooted at one directory. Metadata lives in the file names; there is no database state. */
export function createThumbnailStore(root: string): ThumbnailStore {
  const resolvedRoot = path.resolve(root);
  const pathOf = (name: string) => path.join(resolvedRoot, path.basename(name));

  return {
    root: resolvedRoot,
    async ensureRoot() {
      await fs.mkdir(resolvedRoot, { recursive: true });
    },
    pathOf,
    imagePath(folder, filename, stamp) {
      return pathOf(thumbnailFileName(folder, filename, stamp, 'jpg'));
    },
    async exists(name) {
      try {
        return (await fs.stat(pathOf(name))).isFile();
      } catch {
        return false;
      }
    },
    async list() {
      const entries = new Map<string, { mtimeMs: number | null }>();
      let names: string[];
      try {
        names = await fs.readdir(resolvedRoot);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return entries;
        throw error;
      }
      for (const name of names) {
        const parsed = parseThumbnailFileName(name);
        if (!parsed) continue;
        // Only failure markers need their age; it decides when a failure is retried.
        let mtimeMs: number | null = null;
        if (parsed.kind === 'failed') {
          try { mtimeMs = (await fs.stat(pathOf(name))).mtimeMs; } catch { continue; }
        }
        entries.set(name, { mtimeMs });
      }
      return entries;
    },
    async listStaleTemporaryFiles(olderThanMs, now) {
      let names: string[];
      try { names = await fs.readdir(resolvedRoot); } catch { return []; }
      const stale: string[] = [];
      for (const name of names) {
        if (!TEMP_PATTERN.test(name)) continue;
        try {
          if (now - (await fs.stat(pathOf(name))).mtimeMs > olderThanMs) stale.push(name);
        } catch { /* removed meanwhile */ }
      }
      return stale;
    },
    async remove(names) {
      let removed = 0;
      for (const name of names) {
        // Deletion is limited to files this store names, directly inside its root.
        if (!parseThumbnailFileName(name) && !TEMP_PATTERN.test(name)) continue;
        try {
          await fs.rm(pathOf(name), { force: true });
          removed += 1;
        } catch { /* best effort */ }
      }
      return removed;
    },
    async writeFailure(folder, filename, stamp, detail) {
      await fs.mkdir(resolvedRoot, { recursive: true });
      const body = `${JSON.stringify({ folder, filename, stamp, ...detail, at: new Date().toISOString() })}\n`;
      await fs.writeFile(pathOf(thumbnailFileName(folder, filename, stamp, 'failed')), body, 'utf8');
    },
  };
}
