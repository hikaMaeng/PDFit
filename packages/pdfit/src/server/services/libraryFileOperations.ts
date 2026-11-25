import path from 'node:path';
import fs from 'node:fs/promises';
import type { LibraryFileOperation, LibraryFileOperationResult, LibraryFileOperationStore, LibraryFileRef } from '../../shared/libraryFileOperations.js';
import type { CoverOverrideStore } from '../covers/coverOverrideStore.js';
import { INTERACTIVE_TASK_PRIORITY } from '../tasks/taskProtocol.js';
import type { TaskScheduler } from '../tasks/taskScheduler.js';
import { sanitizeName, UPLOAD_STAGING_PREFIX } from './filesystem.js';
import { LibraryOfflineError } from './libraryVolume.js';
import type { FilesystemService } from './types.js';
import type { WatcherController } from './watcher.js';
import type { LibraryDiskOperation } from './libraryFileOperation.worker.js';

export class LibraryFileOperationError extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string) { super(message); }
}

export const LIBRARY_FILE_OPERATION_TASK = 'library-file-operation';

type Reservation = { folder: string; filename?: string };
const fold = (value: string) => value.normalize('NFC').toLowerCase();

function validPath({ folder, filename }: LibraryFileRef): boolean {
  return Boolean(folder) && folder !== '.' && folder !== '..' && folder === sanitizeName(folder)
    && filename === sanitizeName(filename) && /\.pdf$/i.test(filename) && !/[\\\u0000]/.test(folder + filename);
}

export function overlaps(left: Reservation, right: Reservation): boolean {
  return fold(left.folder) === fold(right.folder)
    && (left.filename === undefined || right.filename === undefined || fold(left.filename) === fold(right.filename));
}

export function touches(operation: LibraryFileOperation, ref: Reservation): boolean {
  return overlaps(operation.source, ref) || (operation.destination !== null && overlaps(operation.destination, ref));
}

function isMissingLibraryPath(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function toDiskOperation(operation: LibraryFileOperation, filesystem: FilesystemService): LibraryDiskOperation {
  const source = filesystem.getFilePath(operation.source.folder, operation.source.filename);
  const destination = operation.destination && filesystem.getFilePath(operation.destination.folder, operation.destination.filename);
  return {
    source, destination,
    staging: path.join(path.dirname(source), `${UPLOAD_STAGING_PREFIX}${operation.id}.part`),
    size: operation.size, modifiedAt: operation.modifiedAt,
  };
}

export function createLibraryFileOperations(
  store: LibraryFileOperationStore,
  filesystem: FilesystemService,
  watcher: WatcherController,
  scheduler: TaskScheduler,
  covers?: CoverOverrideStore,
) {
  const reservations = new Set<Reservation[]>();
  const plannedTask = (operation: LibraryFileOperation) => ({ key: operation.id, payload: operation, priority: INTERACTIVE_TASK_PRIORITY });

  scheduler.register<LibraryFileOperation, LibraryFileOperationResult>({
    type: LIBRARY_FILE_OPERATION_TASK,
    script: new URL('./libraryFileOperation.worker.js', import.meta.url),
    async plan() { return (await store.list()).map(plannedTask); },
    prepare({ payload }) {
      if (filesystem.volume.isOffline()) throw new LibraryOfflineError();
      return toDiskOperation(payload, filesystem);
    },
    async onSettled({ payload }, outcome) {
      if (!outcome.ok) {
        await store.fail(payload.id, outcome.error.message);
        console.warn(`[library-file-operation] ${payload.id}: ${outcome.error.message}`);
        return;
      }
      if (outcome.result.status === 'applied') {
        const { source, destination } = payload;
        const coverChange = destination ? covers?.move(source, destination) : covers?.remove(source.folder, source.filename);
        await coverChange?.catch((error: unknown) => console.warn('[library-file-operation] cover update failed:', error));
      }
      await watcher.mutateIndex(() => store.finish(payload, outcome.result));
      if (outcome.result.status !== 'applied') {
        console.warn(`[library-file-operation] ${payload.id}: synchronized the original path (${outcome.result.status})`);
        for (const event of ['folders-changed', 'tags-changed', 'favorites-changed']) watcher.bus.emit('change', event);
      }
    },
  });

  return {
    async enqueue(source: LibraryFileRef, destination: LibraryFileRef | null) {
      if (!validPath(source) || (destination && !validPath(destination))) {
        throw new LibraryFileOperationError(400, 'The PDF path is invalid.');
      }
      const result = await watcher.mutateIndex(() => {
        const busy = [...reservations].some((refs) => refs.some((ref) => overlaps(source, ref) || (destination && overlaps(destination, ref))));
        if (busy) throw new LibraryFileOperationError(409, 'A file operation is already using this path.');
        return store.enqueue(source, destination);
      });
      if (result.operation) scheduler.submit(LIBRARY_FILE_OPERATION_TASK, plannedTask(result.operation));
      return result.file;
    },
    async withPaths<T>(refs: Reservation[], operation: () => Promise<T>): Promise<T> {
      await watcher.mutateIndex(async () => {
        if ((await store.list()).some((pending) => refs.some((ref) => touches(pending, ref)))) {
          throw new LibraryFileOperationError(409, 'A pending file operation is using this path.');
        }
        reservations.add(refs);
      });
      try { return await operation(); }
      finally { reservations.delete(refs); }
    },
    async retry() {
      for (const operation of await store.list()) scheduler.submit(LIBRARY_FILE_OPERATION_TASK, plannedTask(operation));
    },
    async status() {
      const operations = await store.list();
      return { pending: operations.length, failures: operations.filter((operation) => operation.lastError)
        .slice(0, 20).map(({ id, lastError }) => ({ id, error: lastError })) };
    },
    async readablePath(ref: LibraryFileRef): Promise<string> {
      const operation = await store.findDestination(ref);
      const direct = filesystem.getFilePath(ref.folder, ref.filename);
      if (!operation) return direct;
      const { source, staging, size, modifiedAt } = toDiskOperation(operation, filesystem);
      for (const candidate of [direct, source, staging, direct]) {
        const stat = await filesystem.volume.run(() => fs.lstat(candidate)).catch((error: unknown) => {
          if (isMissingLibraryPath(error)) return null;
          throw error;
        });
        if (stat?.isFile() && stat.size === size && stat.mtime.getTime() === Date.parse(modifiedAt)) return candidate;
      }
      throw new LibraryFileOperationError(404, 'File not found.');
    },
  };
}

export type LibraryFileOperations = ReturnType<typeof createLibraryFileOperations>;
