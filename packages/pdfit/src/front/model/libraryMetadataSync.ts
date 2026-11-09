import { revalidatePdfitMetadataCache } from '../cache/metadataCache.js';
import { flushMetadataOutbox, hasPendingMetadataOutbox } from '../cache/metadataOutbox.js';
import { backgroundSyncModel } from './backgroundSyncModel.js';

/** Reconciles another device's folder and tag changes without masking local writes. */
export async function synchronizeLibraryMetadata(): Promise<boolean> {
  if (backgroundSyncModel.getEntries().some((entry) => entry.status !== 'synced')) return false;
  if (await hasPendingMetadataOutbox()) {
    await flushMetadataOutbox();
    if (await hasPendingMetadataOutbox()) return false;
  }
  if (backgroundSyncModel.getEntries().some((entry) => entry.status !== 'synced')) return false;
  return revalidatePdfitMetadataCache(async () =>
    !await hasPendingMetadataOutbox()
    && !backgroundSyncModel.getEntries().some((entry) => entry.status !== 'synced'));
}
