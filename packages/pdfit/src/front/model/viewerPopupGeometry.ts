export type ViewerPopupKind = 'bot' | 'comments' | 'ocr' | 'outline';
export type PopupBounds = { width: number; height: number };
export type PopupRect = PopupBounds & { x: number; y: number };
export type PopupGesture = 'move' | 'resize';

export function viewerPopupBookKey({ folder, filename, driveFileId }: {
  folder: string; filename: string; driveFileId?: string | null;
}) {
  return JSON.stringify(driveFileId ? ['drive', driveFileId] : ['local', folder, filename]);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function edgeGap(size: number) {
  return Math.min(8, Math.floor(size / 4));
}

export function fitPopupRect(rect: PopupRect, bounds: PopupBounds, minimum: PopupBounds): PopupRect {
  const gapX = edgeGap(bounds.width);
  const gapY = edgeGap(bounds.height);
  const maxWidth = bounds.width - 2 * gapX;
  const maxHeight = bounds.height - 2 * gapY;
  const width = clamp(rect.width, Math.min(minimum.width, maxWidth), maxWidth);
  const height = clamp(rect.height, Math.min(minimum.height, maxHeight), maxHeight);
  return {
    x: clamp(rect.x, gapX, bounds.width - width - gapX),
    y: clamp(rect.y, gapY, bounds.height - height - gapY),
    width,
    height,
  };
}

export function adjustPopupRect(rect: PopupRect, gesture: PopupGesture, dx: number, dy: number,
  bounds: PopupBounds, minimum: PopupBounds): PopupRect {
  const start = fitPopupRect(rect, bounds, minimum);
  if (gesture === 'move') {
    return fitPopupRect({ ...start, x: start.x + dx, y: start.y + dy }, bounds, minimum);
  }
  const maxWidth = bounds.width - start.x - edgeGap(bounds.width);
  const maxHeight = bounds.height - start.y - edgeGap(bounds.height);
  return {
    ...start,
    width: clamp(start.width + dx, Math.min(minimum.width, maxWidth), maxWidth),
    height: clamp(start.height + dy, Math.min(minimum.height, maxHeight), maxHeight),
  };
}

class PopupPreference {
  private readonly listeners = new Set<() => void>();
  private rect: PopupRect | null = null;

  constructor(private readonly storageKey: string) {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null') as Partial<PopupRect> | null;
      if (saved && typeof saved.x === 'number' && Number.isFinite(saved.x) &&
        typeof saved.y === 'number' && Number.isFinite(saved.y) &&
        typeof saved.width === 'number' && Number.isFinite(saved.width) && saved.width > 0 &&
        typeof saved.height === 'number' && Number.isFinite(saved.height) && saved.height > 0) {
        this.rect = { x: saved.x, y: saved.y, width: saved.width, height: saved.height };
      }
    } catch { /* Storage is optional. */ }
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = () => this.rect;

  save(rect: PopupRect) {
    this.rect = rect;
    try { window.localStorage.setItem(this.storageKey, JSON.stringify(rect)); } catch { /* Keep this session usable. */ }
    this.listeners.forEach((listener) => listener());
  }
}

const preferences = new Map<string, PopupPreference>();

export function getPopupPreference(kind: ViewerPopupKind, bookKey: string) {
  const key = `pdfit.viewerPopup.v1:${kind}:${bookKey}`;
  let preference = preferences.get(key);
  if (!preference) {
    preference = new PopupPreference(key);
    preferences.set(key, preference);
  }
  return preference;
}
