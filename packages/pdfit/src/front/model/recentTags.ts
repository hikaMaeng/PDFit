import { publishWindowSyncMessage, subscribeWindowSyncMessage } from './windowSync.js';

const histories = new Map<string, RecentTagHistory>();
const topic = 'recent-tags-changed';

class RecentTagHistory {
  private stored: string | null = null;
  private tags: readonly string[] = [];

  constructor(private readonly key: string) {}

  getSnapshot = (): readonly string[] => {
    try {
      const stored = window.localStorage.getItem(this.key);
      if (stored !== this.stored) {
        this.stored = stored;
        this.tags = [];
        const parsed: unknown = JSON.parse(stored ?? '[]');
        if (Array.isArray(parsed)) {
          this.tags = [...new Set(parsed.filter((tag): tag is string => typeof tag === 'string' && !!tag.trim()))].slice(0, 3);
        }
      }
    } catch { /* Keep the in-memory history when browser storage is unavailable. */ }
    return this.tags;
  };

  subscribe = (listener: () => void): (() => void) => subscribeWindowSyncMessage(topic, (key) => {
    if (key === this.key) listener();
  });

  record(tag: string): void {
    const previous = this.getSnapshot();
    this.tags = [tag, ...previous.filter((entry) => entry !== tag)].slice(0, 3);
    const stored = JSON.stringify(this.tags);
    try {
      window.localStorage.setItem(this.key, stored);
      this.stored = stored;
    } catch { /* Keep the in-memory history when browser storage is unavailable. */ }
    if (typeof window !== 'undefined') publishWindowSyncMessage(topic, this.key);
  }
}

/** Manual additions share a browser history within one library account. See docs/usage.md#manage-tags. */
export function recentTagsForScope(scope: string): RecentTagHistory {
  const key = `pdfit.recent-tags.v1.${encodeURIComponent(scope)}`;
  let history = histories.get(key);
  if (!history) {
    history = new RecentTagHistory(key);
    histories.set(key, history);
  }
  return history;
}
