import type { BookClipCount } from '../../common/protocol/bookmarks/index.js';
import { publishWindowSyncMessage, subscribeWindowSyncMessage } from './windowSync.js';

const TOPIC = 'bookmark.count';
type BookCountChange = BookClipCount & { folder: string; filename: string };
const counts = new Map<string, BookClipCount>();
const listeners = new Set<() => void>();
const bookKey = (folder: string, filename: string) => `${folder}\u0000${filename}`;

export const bookClipCountModel = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  get(folder: string, filename: string) {
    return counts.get(bookKey(folder, filename));
  },

  connect() {
    return subscribeWindowSyncMessage<BookCountChange>(TOPIC, (change) => {
      if (typeof change?.folder !== 'string' || typeof change.filename !== 'string'
        || !Number.isSafeInteger(change.clipCount) || change.clipCount < 0
        || !Number.isSafeInteger(change.clipCountRevision) || change.clipCountRevision < 1) return;
      const key = bookKey(change.folder, change.filename);
      if ((counts.get(key)?.clipCountRevision ?? 0) >= change.clipCountRevision) return;
      counts.set(key, change);
      listeners.forEach((listener) => listener());
    });
  },
};

export function publishBookClipCount({ folder, filename }: { folder: string; filename: string }, count: BookClipCount) {
  publishWindowSyncMessage<BookCountChange>(TOPIC, { folder, filename, ...count });
}
