/** Wait long enough for the local library's 15-second cooldown to expire. */
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 8000];

export function isTransientPdfOpenError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 0 || status === 502 || status === 503 || status === 504;
}

function waitForRetry(delay: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, delay);
    function abort() {
      clearTimeout(timeout);
      reject(signal.reason);
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}

export async function openPdfWithRetry<T>(open: () => Promise<T>, signal: AbortSignal, onRetry: () => void): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    signal.throwIfAborted();
    try {
      return await open();
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (signal.aborted || delay === undefined || !isTransientPdfOpenError(error)) throw error;
      onRetry();
      await waitForRetry(delay, signal);
    }
  }
}
