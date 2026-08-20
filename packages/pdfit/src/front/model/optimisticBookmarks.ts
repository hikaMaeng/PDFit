import type { BookmarkRecord, CreateBookmarkRequest, UpdateBookmarkRequest } from '../../common/protocol/bookmarks/index.js';
import { createBookmark, deleteBookmark, updateBookmark } from '../api/bookmarks.js';
import { cacheBookmarkRecord, deleteCachedBookmark } from '../cache/metadataCache.js';
import { publishBookmarkChange } from './bookmarkEvents.js';
import { beginMutationPerformance } from './mutationPerformance.js';

export interface BookmarkMutationHooks {
  upsert(record: BookmarkRecord): void;
  remove(id: string): void;
  failed?(message: string, retry: () => void): void;
}

export interface BookmarkMutationResult {
  optimistic: BookmarkRecord;
  completion: Promise<boolean>;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function createBookmarkOptimistically(
  folder: string,
  filename: string,
  input: CreateBookmarkRequest,
  hooks: BookmarkMutationHooks,
): BookmarkMutationResult {
  const operationId = input.operationId ?? crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const optimistic: BookmarkRecord = {
    id: `pending-bookmark-${operationId}`,
    folder,
    filename,
    pageIndex: input.pageIndex,
    rect: input.rect,
    borderColor: input.borderColor,
    fillColor: input.fillColor ?? null,
    fillOpacity: input.fillOpacity ?? 0,
    comment: input.comment ?? null,
    imageMimeType: input.imageMimeType,
    imageUrl: `data:${input.imageMimeType};base64,${input.imageBase64.replace(/^data:[^,]+,/, '')}`,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const timing = beginMutationPerformance('bookmark.create', operationId);
  hooks.upsert(optimistic);
  publishBookmarkChange({ folder, filename, kind: 'created', record: optimistic });
  timing.mark('ui');

  const synchronize = async (): Promise<boolean> => {
    try {
      await cacheBookmarkRecord(optimistic);
      timing.mark('indexeddb');
      timing.mark('request-start');
      const saved = await createBookmark(folder, filename, { ...input, operationId });
      timing.mark('server-response');
      await deleteCachedBookmark(optimistic.id);
      hooks.remove(optimistic.id);
      hooks.upsert(saved);
      publishBookmarkChange({ folder, filename, kind: 'deleted', id: optimistic.id });
      publishBookmarkChange({ folder, filename, kind: 'created', record: saved });
      timing.mark('sync-complete');
      return true;
    } catch (error) {
      await deleteCachedBookmark(optimistic.id).catch(() => undefined);
      hooks.remove(optimistic.id);
      publishBookmarkChange({ folder, filename, kind: 'deleted', id: optimistic.id });
      const retry = () => { createBookmarkOptimistically(folder, filename, { ...input, operationId }, hooks); };
      hooks.failed?.(errorMessage(error, '북마크를 저장하지 못했습니다.'), retry);
      timing.mark('failed');
      return false;
    }
  };
  return { optimistic, completion: synchronize() };
}

export function updateBookmarkOptimistically(
  current: BookmarkRecord,
  update: UpdateBookmarkRequest,
  hooks: BookmarkMutationHooks,
): BookmarkMutationResult {
  const optimistic = { ...current, ...update, updatedAt: new Date().toISOString() };
  const timing = beginMutationPerformance('bookmark.update');
  hooks.upsert(optimistic);
  publishBookmarkChange({ folder: current.folder, filename: current.filename, kind: 'updated', record: optimistic });
  timing.mark('ui');
  const synchronize = async (): Promise<boolean> => {
    try {
      await cacheBookmarkRecord(optimistic);
      timing.mark('indexeddb');
      timing.mark('request-start');
      const saved = await updateBookmark(current.id, update);
      timing.mark('server-response');
      hooks.upsert(saved);
      publishBookmarkChange({ folder: saved.folder, filename: saved.filename, kind: 'updated', record: saved });
      timing.mark('sync-complete');
      return true;
    } catch (error) {
      await cacheBookmarkRecord(current).catch(() => undefined);
      hooks.upsert(current);
      publishBookmarkChange({ folder: current.folder, filename: current.filename, kind: 'updated', record: current });
      const retry = () => { updateBookmarkOptimistically(current, update, hooks); };
      hooks.failed?.(errorMessage(error, '북마크를 수정하지 못했습니다.'), retry);
      timing.mark('failed');
      return false;
    }
  };
  return { optimistic, completion: synchronize() };
}

export function deleteBookmarkOptimistically(record: BookmarkRecord, hooks: BookmarkMutationHooks): BookmarkMutationResult {
  const timing = beginMutationPerformance('bookmark.delete');
  hooks.remove(record.id);
  publishBookmarkChange({ folder: record.folder, filename: record.filename, kind: 'deleted', id: record.id });
  timing.mark('ui');
  const synchronize = async (): Promise<boolean> => {
    try {
      await deleteCachedBookmark(record.id);
      timing.mark('indexeddb');
      timing.mark('request-start');
      await deleteBookmark(record.id);
      timing.mark('server-response');
      timing.mark('sync-complete');
      return true;
    } catch (error) {
      await cacheBookmarkRecord(record).catch(() => undefined);
      hooks.upsert(record);
      publishBookmarkChange({ folder: record.folder, filename: record.filename, kind: 'created', record });
      const retry = () => { deleteBookmarkOptimistically(record, hooks); };
      hooks.failed?.(errorMessage(error, '북마크를 삭제하지 못했습니다.'), retry);
      timing.mark('failed');
      return false;
    }
  };
  return { optimistic: record, completion: synchronize() };
}
