import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject, type WheelEvent as ReactWheelEvent } from 'react';

type PanStart = { pointerId: number; clientX: number; clientY: number; scrollLeft: number; scrollTop: number };

/** Provides hand-style PDF panning while the select tool is over empty page space. */
export function usePdfPan(viewportRef: RefObject<HTMLDivElement | null>, enabled: boolean, onEmptyPress: () => void) {
  const startRef = useRef<PanStart | null>(null);
  const [active, setActive] = useState(false);

  const pointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest('[data-annotation-id], button, input, textarea, select, [role="button"], [role="dialog"]')) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    onEmptyPress();
    startRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop };
    setActive(true);
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [enabled, onEmptyPress, viewportRef]);

  const pointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    const viewport = viewportRef.current;
    if (!start || !viewport || start.pointerId !== event.pointerId) return;
    event.preventDefault();
    viewport.scrollLeft = start.scrollLeft - (event.clientX - start.clientX);
    viewport.scrollTop = start.scrollTop - (event.clientY - start.clientY);
  }, [viewportRef]);

  const finish = useCallback((event?: ReactPointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (event && start && start.pointerId !== event.pointerId) return;
    startRef.current = null;
    setActive(false);
    if (event && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const wheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (!enabled) return;
    const target = event.target;
    if (target instanceof Element && target.closest('aside, button, input, textarea, select, [role="dialog"]')) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    event.preventDefault();
    viewport.scrollLeft += event.deltaX;
    viewport.scrollTop += event.deltaY;
  }, [enabled, viewportRef]);

  return { active, pointerDown, pointerMove, pointerUp: finish, pointerCancel: finish, wheel };
}
