import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { listAllBookmarks, listBookmarks } from '../../api/bookmarks.js';
import { subscribeBookmarkChanges } from '../../model/bookmarkEvents.js';
import { BookmarkModel, bookmarkLibraryModel } from '../../model/bookmarkModel.js';
import { usePdfitI18n } from '../../i18n/usePdfitI18n.js';

export interface ClipBook {
  folder: string;
  filename: string;
  driveFileId?: string;
}

export function useClipCollection(book?: ClipBook) {
  const { folder, filename, driveFileId } = book ?? {};
  const { t } = usePdfitI18n();
  const model = useMemo(() => filename === undefined ? bookmarkLibraryModel : new BookmarkModel(), [folder, filename, driveFileId]);
  useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const bookmarks = model.getAll();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => model.refresh(() => folder !== undefined && filename !== undefined
    ? listBookmarks(folder, filename, driveFileId)
    : listAllBookmarks()), [model, folder, filename, driveFileId]);

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeBookmarkChanges((signal) => {
      if (filename !== undefined && (signal.folder !== folder || signal.filename !== filename)) return;
      if (signal.record) model.upsert(signal.record);
      else if (signal.id) model.remove(signal.id);
    });
    setLoading(true);
    setError(null);
    void refresh()
      .catch(() => { if (active) setError(t('clipLoadFailed')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; unsubscribe(); };
  }, [model, folder, filename, refresh, t]);

  const hasPendingOcr = bookmarks.some((record) => record.ocr?.status === 'pending');
  useEffect(() => {
    if (!hasPendingOcr) return;
    // The server reads a clip asynchronously. Poll the current scope for up to five minutes.
    let active = true;
    let timer: number;
    const deadline = Date.now() + 300_000;
    const schedule = () => {
      if (!active || Date.now() >= deadline) return;
      timer = window.setTimeout(async () => {
        await refresh().catch(() => undefined);
        schedule();
      }, 5_000);
    };
    schedule();
    return () => { active = false; window.clearTimeout(timer); };
  }, [hasPendingOcr, refresh]);

  return { bookmarks, loading, error, refresh, model };
}
