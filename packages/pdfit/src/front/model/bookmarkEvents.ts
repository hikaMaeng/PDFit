// see docs/internals.md#cross-window-bookmark-change-contract

import { publishWindowSyncMessage, subscribeWindowSyncMessage } from './windowSync.js';

const BOOKMARK_CHANGE_TOPIC = 'bookmark.change';

export type BookmarkChangeKind = 'created' | 'updated' | 'deleted';

export interface BookmarkChangeTarget {
  folder: string;
  filename: string;
  kind: BookmarkChangeKind;
}

export function publishBookmarkChange(target: BookmarkChangeTarget) {
  publishWindowSyncMessage(BOOKMARK_CHANGE_TOPIC, target);
}

export function subscribeBookmarkChanges(listener: (signal: BookmarkChangeTarget) => void) {
  return subscribeWindowSyncMessage<BookmarkChangeTarget>(BOOKMARK_CHANGE_TOPIC, (payload) => {
    if (
      typeof payload?.folder !== 'string'
      || typeof payload.filename !== 'string'
      || (payload.kind !== 'created' && payload.kind !== 'updated' && payload.kind !== 'deleted')
    ) return;
    listener(payload);
  });
}
