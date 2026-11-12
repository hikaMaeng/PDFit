import fs from 'node:fs/promises';
import path from 'node:path';
import { thumbnailIdentityHash } from '../thumbnails/thumbnailStore.js';
import type { BookCoverSource, CoverImageType } from './coverSources.js';

/**
 * A real-book cover the user chose for one PDF, replacing its rendered first page.
 *
 * State contract:
 *   key       (folder, filename) of a local library file, hashed exactly like thumbnails
 *   scope     one library (one thumbnail root); `<thumbnailRoot>/covers`
 *   lifetime  until the user restores the first page, or the file is deleted or moved
 *   bound     one image plus one JSON record per library file; replacing deletes the old image
 *   cleared   by `remove` (restore button, file delete) and `move` (file move)
 *
 * Unlike rendered thumbnails it does not depend on the PDF's modification stamp: an
 * edited PDF keeps the cover the user picked.
 */
export interface CoverOverrideRecord {
  folder: string;
  filename: string;
  /** Changes on every replacement; the client puts it in the thumbnail URL as `c`. */
  version: string;
  type: CoverImageType;
  source: BookCoverSource;
  title: string;
  imageUrl: string;
  pageUrl?: string;
  at: string;
}

export interface CoverOverride extends CoverOverrideRecord { path: string }

export interface CoverOverrideStore {
  readonly root: string;
  get(folder: string, filename: string): Promise<CoverOverride | null>;
  list(): Promise<CoverOverrideRecord[]>;
  set(folder: string, filename: string, image: { bytes: Buffer; type: CoverImageType }, meta: Pick<CoverOverrideRecord, 'source' | 'title' | 'imageUrl' | 'pageUrl'>): Promise<CoverOverrideRecord>;
  remove(folder: string, filename: string): Promise<boolean>;
  move(from: { folder: string; filename: string }, to: { folder: string; filename: string }): Promise<boolean>;
}

const EXTENSION: Record<CoverImageType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const IMAGE_NAME = /^([0-9a-f]{40})\.([0-9a-z]{1,16})\.(jpg|png|webp)$/;
const RECORD_NAME = /^([0-9a-f]{40})\.json$/;

function isRecord(value: unknown): value is CoverOverrideRecord {
  const record = value as Partial<CoverOverrideRecord> | null;
  return Boolean(record) && typeof record?.folder === 'string' && typeof record.filename === 'string'
    && typeof record.version === 'string' && /^[0-9a-z]{1,16}$/.test(record.version)
    && (record.type === 'image/jpeg' || record.type === 'image/png' || record.type === 'image/webp');
}

export function createCoverOverrideStore(root: string): CoverOverrideStore {
  const resolvedRoot = path.resolve(root);
  const recordPath = (hash: string) => path.join(resolvedRoot, `${hash}.json`);
  const imageName = (hash: string, version: string, type: CoverImageType) => `${hash}.${version}.${EXTENSION[type]}`;
  // Monotonic within the process even when two replacements land in the same millisecond.
  let lastVersion = 0;
  const nextVersion = () => { lastVersion = Math.max(Date.now(), lastVersion + 1); return lastVersion.toString(36); };

  async function readRecord(hash: string): Promise<CoverOverrideRecord | null> {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(recordPath(hash), 'utf8'));
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async function removeImages(hash: string, keep?: string) {
    let names: string[];
    try { names = await fs.readdir(resolvedRoot); } catch { return; }
    for (const name of names) {
      const match = IMAGE_NAME.exec(name);
      if (match && match[1] === hash && name !== keep) await fs.rm(path.join(resolvedRoot, name), { force: true });
    }
  }

  return {
    root: resolvedRoot,
    async get(folder, filename) {
      const hash = thumbnailIdentityHash(folder, filename);
      const record = await readRecord(hash);
      if (!record || record.folder !== folder || record.filename !== filename) return null;
      const imagePath = path.join(resolvedRoot, imageName(hash, record.version, record.type));
      try {
        if (!(await fs.stat(imagePath)).isFile()) return null;
      } catch {
        return null;
      }
      return { ...record, path: imagePath };
    },
    async list() {
      let names: string[];
      try { names = await fs.readdir(resolvedRoot); } catch { return []; }
      const records: CoverOverrideRecord[] = [];
      for (const name of names) {
        const match = RECORD_NAME.exec(name);
        if (!match) continue;
        const record = await readRecord(match[1]);
        if (record) records.push(record);
      }
      return records;
    },
    async set(folder, filename, image, meta) {
      await fs.mkdir(resolvedRoot, { recursive: true });
      const hash = thumbnailIdentityHash(folder, filename);
      const version = nextVersion();
      const name = imageName(hash, version, image.type);
      const temporary = path.join(resolvedRoot, `${name}.tmp`);
      await fs.writeFile(temporary, image.bytes);
      await fs.rename(temporary, path.join(resolvedRoot, name));
      const record: CoverOverrideRecord = { folder, filename, version, type: image.type, source: meta.source, title: meta.title, imageUrl: meta.imageUrl, ...(meta.pageUrl ? { pageUrl: meta.pageUrl } : {}), at: new Date().toISOString() };
      const recordTemporary = `${recordPath(hash)}.tmp`;
      await fs.writeFile(recordTemporary, `${JSON.stringify(record)}\n`, 'utf8');
      await fs.rename(recordTemporary, recordPath(hash));
      await removeImages(hash, name);
      return record;
    },
    async remove(folder, filename) {
      const hash = thumbnailIdentityHash(folder, filename);
      const record = await readRecord(hash);
      await fs.rm(recordPath(hash), { force: true });
      await removeImages(hash);
      return Boolean(record);
    },
    async move(from, to) {
      const current = await this.get(from.folder, from.filename);
      if (!current) return false;
      const bytes = await fs.readFile(current.path);
      await this.set(to.folder, to.filename, { bytes, type: current.type }, current);
      await this.remove(from.folder, from.filename);
      return true;
    },
  };
}
