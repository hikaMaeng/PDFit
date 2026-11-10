import fs from 'node:fs/promises';
import path from 'node:path';
import { INTERACTIVE_TASK_PRIORITY, type TaskEnvelope, type TaskOutcome } from '../tasks/taskProtocol.js';
import type { PeriodicTaskDefinition, PlannedTask, TaskSubmitOutcome } from '../tasks/taskScheduler.js';
import {
  THUMBNAIL_FAILURE_RETRY_MS, THUMBNAIL_JPEG_QUALITY, THUMBNAIL_WIDTH,
  thumbnailFileName, thumbnailSourceStamp, type ThumbnailStore,
} from './thumbnailStore.js';
import type { ThumbnailTaskPayload, ThumbnailTaskResult } from './thumbnailTask.worker.js';

export const THUMBNAIL_TASK_TYPE = 'thumbnail';

/** Worker input plus what the main thread needs to record a failure. */
export interface ThumbnailPlanPayload extends ThumbnailTaskPayload {
  folder: string;
  filename: string;
  stamp: string;
}

export interface ThumbnailPlanSummary {
  at: string;
  /** PDFs found in the library. */
  sources: number;
  /** PDFs that already had a thumbnail for their current modification time and size. */
  ready: number;
  /** PDFs skipped because a recent attempt failed. */
  failed: number;
  /** PDFs queued for rendering by this plan. */
  queued: number;
  /** Thumbnail files removed because their PDF changed or no longer exists. */
  removed: number;
  /** False when part of the library could not be read; cleanup is skipped in that case. */
  complete: boolean;
}

export type ThumbnailLookup =
  | { state: 'ready'; path: string }
  | { state: 'queued' | 'failed' | 'missing' };

export interface ThumbnailService {
  definition: PeriodicTaskDefinition<ThumbnailPlanPayload, ThumbnailTaskResult>;
  /** Looks a thumbnail up by a stamp the client already knows. No library I/O. */
  find(folder: string, filename: string, stamp: string): Promise<string | null>;
  /** Checks the PDF itself; returns its current thumbnail or queues one ahead of the periodic work. */
  resolve(folder: string, filename: string): Promise<ThumbnailLookup>;
  lastPlan(): ThumbnailPlanSummary | null;
}

interface LibrarySource {
  folder: string;
  filename: string;
  sourcePath: string;
  stamp: string;
}

const STAT_CONCURRENCY = 8;
const STALE_TEMPORARY_FILE_MS = 60 * 60 * 1000;
// Compiled output runs `.js`; `tsx` development runs the `.ts` source directly.
/** The shared render script. A hosted runtime's own thumbnail job points at the same module. */
export const THUMBNAIL_TASK_SCRIPT_URL = new URL(import.meta.url.endsWith('.ts') ? './thumbnailTask.worker.ts' : './thumbnailTask.worker.js', import.meta.url);

function isPdfName(name: string): boolean {
  return name.toLowerCase().endsWith('.pdf');
}

function isPlainName(name: string): boolean {
  return name.length > 0 && name !== '.' && name !== '..' && !/[/\\\u0000]/.test(name);
}

/**
 * First-page thumbnails for a local library: the periodic job definition, plus the
 * lookups the HTTP route uses.
 */
export function createThumbnailService(options: {
  booksRoot: string;
  rootFolderName: string;
  store: ThumbnailStore;
  /** Queues one task on the shared scheduler; wired after the scheduler exists. */
  submit: (task: PlannedTask<ThumbnailPlanPayload>) => TaskSubmitOutcome;
  failureRetryMs?: number;
  log?: (message: string) => void;
}): ThumbnailService {
  const { booksRoot, rootFolderName, store } = options;
  const failureRetryMs = options.failureRetryMs ?? THUMBNAIL_FAILURE_RETRY_MS;
  const log = options.log ?? (() => undefined);
  let lastPlan: ThumbnailPlanSummary | null = null;

  function folderPath(folder: string): string | null {
    if (folder === rootFolderName) return booksRoot;
    if (!isPlainName(folder)) return null;
    return path.join(booksRoot, folder);
  }

  function planned(source: LibrarySource, priority?: number): PlannedTask<ThumbnailPlanPayload> {
    return {
      key: `${source.folder}/${source.filename}@${source.stamp}`,
      priority,
      payload: {
        folder: source.folder,
        filename: source.filename,
        stamp: source.stamp,
        source: { kind: 'file', path: source.sourcePath },
        outputPath: store.imagePath(source.folder, source.filename, source.stamp),
        width: THUMBNAIL_WIDTH,
        quality: THUMBNAIL_JPEG_QUALITY,
      },
    };
  }

  /** Lists every PDF with its current stamp. Throws when the library root itself is unreadable. */
  async function listLibrary(): Promise<{ sources: LibrarySource[]; complete: boolean }> {
    let complete = true;
    const candidates: Array<{ folder: string; filename: string; sourcePath: string }> = [];
    const rootEntries = await fs.readdir(booksRoot, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (entry.isFile() && isPdfName(entry.name)) candidates.push({ folder: rootFolderName, filename: entry.name, sourcePath: path.join(booksRoot, entry.name) });
    }
    for (const entry of rootEntries) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(booksRoot, entry.name);
      try {
        for (const child of await fs.readdir(directory, { withFileTypes: true })) {
          if (child.isFile() && isPdfName(child.name)) candidates.push({ folder: entry.name, filename: child.name, sourcePath: path.join(directory, child.name) });
        }
      } catch (error) {
        complete = false;
        log(`thumbnail plan: cannot read folder ${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const sources: LibrarySource[] = [];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(STAT_CONCURRENCY, candidates.length) }, async () => {
      while (next < candidates.length) {
        const candidate = candidates[next++];
        try {
          const stat = await fs.stat(candidate.sourcePath);
          if (stat.isFile()) sources.push({ ...candidate, stamp: thumbnailSourceStamp(stat.mtime.getTime(), stat.size) });
        } catch {
          complete = false;
        }
      }
    }));
    sources.sort((left, right) => left.folder.localeCompare(right.folder) || left.filename.localeCompare(right.filename));
    return { sources, complete };
  }

  const definition: PeriodicTaskDefinition<ThumbnailPlanPayload, ThumbnailTaskResult> = {
    type: THUMBNAIL_TASK_TYPE,
    script: THUMBNAIL_TASK_SCRIPT_URL,
    timeoutMs: 120_000,

    async plan() {
      await store.ensureRoot();
      const { sources, complete } = await listLibrary();
      const existing = await store.list();
      const now = Date.now();
      // Every file name that is still valid for the library as it is now.
      const expected = new Set<string>();
      const tasks: PlannedTask<ThumbnailPlanPayload>[] = [];
      let ready = 0;
      let failed = 0;
      for (const source of sources) {
        const imageName = thumbnailFileName(source.folder, source.filename, source.stamp, 'jpg');
        if (existing.has(imageName)) {
          expected.add(imageName);
          ready += 1;
          continue;
        }
        const failureName = thumbnailFileName(source.folder, source.filename, source.stamp, 'failed');
        const failure = existing.get(failureName);
        if (failure && now - (failure.mtimeMs ?? 0) < failureRetryMs) {
          expected.add(failureName);
          failed += 1;
          continue;
        }
        tasks.push(planned(source));
      }

      let removed = 0;
      // An unreadable or empty listing usually means the library volume is offline.
      // Removing thumbnails then would throw away work that is still valid.
      if (complete && sources.length > 0) {
        removed = await store.remove([...existing.keys()].filter((name) => !expected.has(name)));
        removed += await store.remove(await store.listStaleTemporaryFiles(STALE_TEMPORARY_FILE_MS, now));
      }
      lastPlan = { at: new Date(now).toISOString(), sources: sources.length, ready, failed, queued: tasks.length, removed, complete };
      return tasks;
    },

    async onSettled(task: TaskEnvelope<ThumbnailPlanPayload>, outcome: TaskOutcome<ThumbnailTaskResult>) {
      if (outcome.ok) return;
      const { folder, filename, stamp } = task.payload;
      log(`thumbnail failed for ${folder}/${filename}: ${outcome.error.code} ${outcome.error.message}`);
      await store.writeFailure(folder, filename, stamp, { code: outcome.error.code, message: outcome.error.message });
    },
  };

  return {
    definition,
    lastPlan: () => lastPlan,

    async find(folder, filename, stamp) {
      const name = thumbnailFileName(folder, filename, stamp, 'jpg');
      return await store.exists(name) ? store.pathOf(name) : null;
    },

    async resolve(folder, filename) {
      const directory = folderPath(folder);
      if (!directory || !isPlainName(filename) || !isPdfName(filename)) return { state: 'missing' };
      const sourcePath = path.join(directory, filename);
      let stamp: string;
      try {
        const stat = await fs.stat(sourcePath);
        if (!stat.isFile()) return { state: 'missing' };
        stamp = thumbnailSourceStamp(stat.mtime.getTime(), stat.size);
      } catch {
        return { state: 'missing' };
      }
      const imageName = thumbnailFileName(folder, filename, stamp, 'jpg');
      if (await store.exists(imageName)) return { state: 'ready', path: store.pathOf(imageName) };
      const failureName = thumbnailFileName(folder, filename, stamp, 'failed');
      if (await store.exists(failureName)) {
        const age = Date.now() - (await fs.stat(store.pathOf(failureName)).then((stat) => stat.mtimeMs, () => 0));
        if (age < failureRetryMs) return { state: 'failed' };
      }
      // Someone is looking at this cover now, so it goes ahead of the periodic backlog.
      const submitted = options.submit(planned({ folder, filename, sourcePath, stamp }, INTERACTIVE_TASK_PRIORITY));
      return submitted === 'full' || submitted === 'unknown-type' ? { state: 'missing' } : { state: 'queued' };
    },
  };
}
