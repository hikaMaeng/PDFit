import fs from 'node:fs/promises';
import path from 'node:path';
import { thumbnailIdentityHash } from '../thumbnails/thumbnailStore.js';

type BookKey = { folder: string; filename: string };

export interface PageOcrSearchIndex {
  listBooks(): Promise<BookKey[]>;
  save(folder: string, filename: string, stamp: string, pageIndex: number, text: string): Promise<void>;
  listPages?(folder: string, filename: string, stamp: string, pageIndex?: number): Promise<number[]>;
}

/** Reuse the old cache on the scheduler's first plan, without opening any PDFs. */
export async function restorePageOcrSearchIndex(cacheRoot: string, cacheVersion: string, index: PageOcrSearchIndex) {
  const files = await fs.readdir(cacheRoot).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const cacheName = /^([a-f0-9]{40})\.(v\d+)-(\d+-\d+)\.p(\d+)\.json$/;
  const candidates = files.map((name) => ({ name, match: cacheName.exec(name) }))
    .filter(({ match }) => match?.[2] === cacheVersion);
  if (!candidates.length) return;
  const books = new Map((await index.listBooks()).map((book) => [thumbnailIdentityHash(book.folder, book.filename), book]));
  for (const { name, match } of candidates) {
    const [, identity, , stamp, indexText] = match!;
    const book = books.get(identity);
    const pageIndex = Number(indexText);
    if (!book || pageIndex >= 2_147_483_647) continue;
    let record: unknown;
    try {
      record = JSON.parse(await fs.readFile(path.join(cacheRoot, name), 'utf8'));
    } catch (error) {
      if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (!record || typeof record !== 'object') continue;
    const { text, source, pageIndex: recordedIndex, metadataStamp } = record as Record<string, unknown>;
    if (typeof text === 'string' && recordedIndex === pageIndex && (source === 'text-layer' || source === 'vision')) {
      const indexStamp = typeof metadataStamp === 'string' ? metadataStamp : stamp;
      await index.save(book.folder, book.filename, indexStamp, pageIndex, text);
    }
  }
}
