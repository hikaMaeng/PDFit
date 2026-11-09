import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';

type PalettePosition = { x: number; y: number };
type DragStart = PalettePosition & { clientX: number; clientY: number; pointerId: number };

const DEFAULT_POSITION: PalettePosition = { x: 12, y: 12 };
const EDGE_GAP = 8;

function savedPosition(storageKey: string): PalettePosition {
  if (typeof window === 'undefined') return DEFAULT_POSITION;
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null') as Partial<PalettePosition> | null;
    return Number.isFinite(value?.x) && Number.isFinite(value?.y) ? { x: Number(value?.x), y: Number(value?.y) } : DEFAULT_POSITION;
  } catch {
    return DEFAULT_POSITION;
  }
}

/** Keeps a floating viewer palette draggable, keyboard-movable, and inside its parent. */
export function useDraggablePalette(storageKey: string) {
  const paletteRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<DragStart | null>(null);
  const [position, setPosition] = useState<PalettePosition>(() => savedPosition(storageKey));

  const clamp = useCallback((candidate: PalettePosition): PalettePosition => {
    const palette = paletteRef.current;
    const parent = palette?.offsetParent as HTMLElement | null;
    if (!palette || !parent) return candidate;
    return {
      x: Math.max(EDGE_GAP, Math.min(candidate.x, Math.max(EDGE_GAP, parent.clientWidth - palette.offsetWidth - EDGE_GAP))),
      y: Math.max(EDGE_GAP, Math.min(candidate.y, Math.max(EDGE_GAP, parent.clientHeight - palette.offsetHeight - EDGE_GAP))),
    };
  }, []);

  const moveTo = useCallback((candidate: PalettePosition) => setPosition(clamp(candidate)), [clamp]);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(position));
  }, [position, storageKey]);

  useEffect(() => {
    const keepInBounds = () => setPosition((current) => clamp(current));
    window.addEventListener('resize', keepInBounds);
    keepInBounds();
    return () => window.removeEventListener('resize', keepInBounds);
  }, [clamp]);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Global listeners remain the fallback. */ }
    dragStartRef.current = { ...position, clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId };
  };

  useEffect(() => {
    const finish = () => { dragStartRef.current = null; };
    const move = (event: globalThis.PointerEvent) => {
      const start = dragStartRef.current;
      if (!start || start.pointerId !== event.pointerId) return;
      if (event.buttons === 0) {
        finish();
        return;
      }
      event.preventDefault();
      moveTo({ x: start.x + event.clientX - start.clientX, y: start.y + event.clientY - start.clientY });
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('mouseup', finish);
    window.addEventListener('blur', finish);
    document.addEventListener('visibilitychange', finish);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('mouseup', finish);
      window.removeEventListener('blur', finish);
      document.removeEventListener('visibilitychange', finish);
    };
  }, [moveTo]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const distance = event.shiftKey ? 20 : 5;
    const offsets: Record<string, PalettePosition> = {
      ArrowLeft: { x: -distance, y: 0 },
      ArrowRight: { x: distance, y: 0 },
      ArrowUp: { x: 0, y: -distance },
      ArrowDown: { x: 0, y: distance },
    };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    event.stopPropagation();
    moveTo({ x: position.x + offset.x, y: position.y + offset.y });
  };

  return {
    paletteRef,
    position,
    dragHandleProps: { onPointerDown, onKeyDown },
  };
}
