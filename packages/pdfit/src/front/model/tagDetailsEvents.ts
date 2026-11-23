import type { TagDetailsChange } from '../../shared/tagDetails.js';
import { publishWindowSyncMessage, subscribeWindowSyncMessage } from './windowSync.js';

const topic = 'tag-details-changed';

export function publishTagDetailsChange(change: TagDetailsChange): void {
  publishWindowSyncMessage(topic, change);
}

export function subscribeTagDetailsChanges(listener: (change: TagDetailsChange) => void): () => void {
  return subscribeWindowSyncMessage(topic, listener);
}

export function tagPath(name: string): string {
  return `/tag/${encodeURIComponent(name)}`;
}

export function tagNameFromPath(pathname: string): string | undefined {
  const segment = /^\/tag\/([^/]+)\/?$/.exec(pathname)?.[1];
  if (!segment) return undefined;
  try { return decodeURIComponent(segment); } catch { return undefined; }
}
