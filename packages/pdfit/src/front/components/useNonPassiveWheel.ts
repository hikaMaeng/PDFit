import { useCallback, useRef } from 'react';

/** The wheel fields the viewer handlers read; satisfied by native and React wheel events. */
export type ViewerWheelEvent = Pick<WheelEvent, 'target' | 'deltaX' | 'deltaY' | 'deltaMode' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey' | 'clientX' | 'clientY' | 'preventDefault'>;

/**
 * Attaches `handler` as a native `wheel` listener with `{ passive: false }` and returns the
 * callback ref to put on the element.
 *
 * React registers `onWheel` as a passive listener, so `preventDefault()` inside it is ignored
 * ("Unable to preventDefault inside passive event listener invocation"): page-mode wheel
 * paging could not stop the browser's own scroll, and wheel panning scrolled twice. The
 * listener follows the element (attached on mount, removed on unmount) and always calls the
 * latest handler, so the ref stays stable across renders.
 */
export function useNonPassiveWheel<T extends HTMLElement>(handler: (event: WheelEvent) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const detachRef = useRef<(() => void) | null>(null);
  return useCallback((element: T | null) => {
    detachRef.current?.();
    detachRef.current = null;
    if (!element) return;
    const listener = (event: WheelEvent) => handlerRef.current(event);
    element.addEventListener('wheel', listener, { passive: false });
    detachRef.current = () => element.removeEventListener('wheel', listener);
  }, []);
}
