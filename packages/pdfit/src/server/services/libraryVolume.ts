/**
 * Every access to the library volume (the NAS) goes through one guard, so an
 * unreachable or hung mount can only fail the work that needs the files: opening a
 * book and adding, moving or deleting library files. Database-backed features never
 * call it.
 *
 * Why a guard and not only async calls: a stat on a dead SMB mount does not fail, it
 * hangs, and each hung call holds one libuv thread-pool thread. A handful of them
 * starve every other file read (local thumbnails, covers) even though the event loop
 * is free.
 *
 * State contract:
 *   key       none; one guard per library volume
 *   scope     one server process, shared by the filesystem service, thumbnails, OCR and the watcher
 *   lifetime  `openUntil` is the end of the current cooldown; `inFlight` counts calls that have
 *             not settled yet, including calls that already timed out
 *   bound     at most `maxInFlight` (12, below the thread pool of 32) calls reach the disk at once; the rest are refused
 *   cleared   `openUntil` expires by time; `inFlight` drops when the call really settles
 */
export class LibraryOfflineError extends Error {
  readonly code = 'LIBRARY_OFFLINE';
  constructor(message = 'The library volume is not reachable.') {
    super(message);
    this.name = 'LibraryOfflineError';
  }
}

export interface LibraryVolumeGuard {
  /** Runs one disk operation; rejects with `LibraryOfflineError` while the volume is down. */
  run<T>(operation: () => Promise<T>): Promise<T>;
  /** True while calls are refused without touching the disk. */
  isOffline(): boolean;
}

const OFFLINE_CODES = new Set(['EHOSTDOWN', 'EHOSTUNREACH', 'ETIMEDOUT', 'ENOTCONN', 'ESTALE', 'ENETDOWN', 'ENETUNREACH', 'ECONNREFUSED', 'ECONNRESET', 'EIO']);

export function createLibraryVolumeGuard(options: { timeoutMs?: number; maxInFlight?: number; cooldownMs?: number; now?: () => number } = {}): LibraryVolumeGuard {
  const timeoutMs = options.timeoutMs ?? 8_000;
  const maxInFlight = options.maxInFlight ?? 12;
  const cooldownMs = options.cooldownMs ?? 15_000;
  const now = options.now ?? Date.now;
  let openUntil = 0;
  let inFlight = 0;

  const trip = () => { openUntil = now() + cooldownMs; };

  return {
    isOffline: () => now() < openUntil,
    run<T>(operation: () => Promise<T>): Promise<T> {
      if (now() < openUntil) return Promise.reject(new LibraryOfflineError());
      // Full means hung calls (or a burst): refuse this one, but let the timeout decide the cooldown.
      if (inFlight >= maxInFlight) return Promise.reject(new LibraryOfflineError('The library volume is busy.'));
      inFlight += 1;
      let started: Promise<T>;
      try { started = operation(); } catch (error) { started = Promise.reject(error); }
      const settled = started.finally(() => { inFlight -= 1; });
      // The caller stops waiting at the timeout; the call keeps its slot until it settles.
      settled.catch(() => undefined);
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => { trip(); reject(new LibraryOfflineError('The library volume did not answer in time.')); }, timeoutMs);
        settled.then(
          (value) => { clearTimeout(timer); resolve(value); },
          (error: unknown) => {
            clearTimeout(timer);
            const code = (error as NodeJS.ErrnoException | undefined)?.code;
            if (code && OFFLINE_CODES.has(code)) { trip(); reject(new LibraryOfflineError(`The library volume is not reachable (${code}).`)); return; }
            reject(error);
          },
        );
      });
    },
  };
}
