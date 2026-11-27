import fs from 'node:fs/promises';
import path from 'node:path';
import { thumbnailIdentityHash } from '../thumbnails/thumbnailStore.js';

type BookKey = { folder: string; filename: string };

export interface PageOcrSearchIndex {
  listBooks(): Promise<BookKey[]>;
  prepareCacheLookup?(): Promise<void>;
  findCacheBook?(hash: string): Promise<BookKey | undefined>;
  save(folder: string, filename: string, stamp: string, pageIndex: number, text: string): Promise<void>;
  listPages?(folder: string, filename: string, stamp: string, pageIndex?: number): Promise<number[]>;
}

/** Reuse the old cache on the scheduler's first plan, without opening any PDFs. */
export async function restorePageOcrSearchIndex(
  cacheRoot: string, cacheVersion: string, index: PageOcrSearchIndex,
  persist: (write: () => Promise<void>) => Promise<void> = (write) => write(),
) {
  const files = await fs.opendir(cacheRoot).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!files) return;
  const cacheName = /^([a-f0-9]{40})\.(v\d+)-(\d+-\d+)\.p(\d+)\.json$/;
  let books: Map<string, BookKey> | undefined;
  let prepared = false;
  let count = 0;
  for await (const { name } of files) {
    if (++count % 16 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    const match = cacheName.exec(name);
    if (match?.[2] !== cacheVersion) continue;
    if (!prepared) {
      if (index.findCacheBook) await index.prepareCacheLookup?.();
      else books = new Map((await index.listBooks()).map((book) => [thumbnailIdentityHash(book.folder, book.filename), book]));
      prepared = true;
    }
    const [, identity, , stamp, indexText] = match;
    const book = index.findCacheBook ? await index.findCacheBook(identity) : books?.get(identity);
    const pageIndex = Number(indexText);
    if (!book || pageIndex >= 2_147_483_647) continue;
    await persist(async () => {
      let record: unknown;
      try {
        record = JSON.parse(await fs.readFile(path.join(cacheRoot, name), 'utf8'));
      } catch (error) {
        if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      if (!record || typeof record !== 'object') return;
      const { text, source, pageIndex: recordedIndex, metadataStamp, edited } = record as Record<string, unknown>;
      if (typeof text === 'string' && (edited === true || text.trim()) && recordedIndex === pageIndex && (source === 'text-layer' || source === 'vision')) {
        const indexStamp = typeof metadataStamp === 'string' ? metadataStamp : stamp;
        await index.save(book.folder, book.filename, indexStamp, pageIndex, text);
      }
    });
  }
}
