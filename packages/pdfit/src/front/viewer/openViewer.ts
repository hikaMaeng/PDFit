// see docs/internals.md#reused-viewer-window-contract

export interface OpenViewerRequest {
  folder: string;
  filename: string;
  page?: number | null;
  driveFileId?: string | null;
}

interface ViewerWindowRecord {
  target: string;
  ownerId: string;
}

interface ViewerCommand extends OpenViewerRequest {
  type: 'pdfit-viewer-command';
  requestId: string;
}

const REGISTRY_KEY = 'pdfit.open-viewers.v1';
const TARGET_PREFIX = 'pdfit-viewer-';
const REUSE_ACK_TIMEOUT_MS = 180;

function bookKey(folder: string, filename: string) {
  return `${folder}\u0000${filename}`;
}

function readRegistry(): Record<string, ViewerWindowRecord> {
  try {
    const value = window.localStorage.getItem(REGISTRY_KEY);
    return value ? JSON.parse(value) as Record<string, ViewerWindowRecord> : {};
  } catch {
    return {};
  }
}

function writeRegistry(registry: Record<string, ViewerWindowRecord>) {
  try {
    window.localStorage.setItem(REGISTRY_KEY, JSON.stringify(registry));
  } catch {
    // Opening a viewer still works when browser storage is unavailable.
  }
}

function randomId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function viewerWindowName(folder: string, filename: string) {
  return `${TARGET_PREFIX}${encodeURIComponent(folder)}--${encodeURIComponent(filename)}`;
}

export function viewerUrl({ folder, filename, page, driveFileId }: OpenViewerRequest) {
  const path = `/viewer/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`;
  const query = new URLSearchParams();
  if (page && page > 0) query.set('page', String(page));
  if (driveFileId) query.set('driveFileId', driveFileId);
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}

export function registerViewerWindow(folder: string, filename: string) {
  const key = bookKey(folder, filename);
  const ownerId = randomId();
  const target = viewerWindowName(folder, filename);
  const registry = readRegistry();
  registry[key] = { target, ownerId };
  writeRegistry(registry);

  return () => {
    const current = readRegistry();
    if (current[key]?.ownerId !== ownerId) return;
    delete current[key];
    writeRegistry(current);
  };
}

export function isViewerCommand(value: unknown): value is ViewerCommand {
  if (!value || typeof value !== 'object') return false;
  const command = value as Partial<ViewerCommand>;
  return command.type === 'pdfit-viewer-command'
    && typeof command.requestId === 'string'
    && typeof command.folder === 'string'
    && typeof command.filename === 'string'
    && (command.driveFileId == null || typeof command.driveFileId === 'string')
    && (command.page == null || (Number.isSafeInteger(command.page) && command.page > 0));
}

/**
 * Focuses the active same-book viewer and sends it a navigation command. A
 * missing acknowledgement means the registry was stale, so the blank target is
 * immediately navigated as a new viewer instead.
 */
export function openViewer(request: OpenViewerRequest) {
  const target = viewerWindowName(request.folder, request.filename);
  const url = viewerUrl(request);
  const record = readRegistry()[bookKey(request.folder, request.filename)];

  if (!record || record.target !== target) {
    const opened = window.open(url, target);
    opened?.focus();
    return;
  }

  // An empty URL reuses a named browsing context without replacing its current
  // document. It creates a blank target only when a stale registry remains.
  const existing = window.open('', target);
  if (!existing || existing.closed) {
    const opened = window.open(url, target);
    opened?.focus();
    return;
  }

  const requestId = randomId();
  let acknowledged = false;
  const acknowledge = (event: MessageEvent) => {
    const data = event.data as { type?: string; requestId?: string } | null;
    if (event.origin !== window.location.origin || data?.type !== 'pdfit-viewer-command-ack' || data.requestId !== requestId) return;
    acknowledged = true;
    window.removeEventListener('message', acknowledge);
  };
  window.addEventListener('message', acknowledge);
  window.setTimeout(() => {
    window.removeEventListener('message', acknowledge);
    if (!acknowledged && !existing.closed) existing.location.replace(url);
  }, REUSE_ACK_TIMEOUT_MS);

  existing.postMessage({ type: 'pdfit-viewer-command', requestId, ...request } satisfies ViewerCommand, window.location.origin);
  existing.focus();
}
