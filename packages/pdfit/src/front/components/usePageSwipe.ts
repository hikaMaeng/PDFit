import { useCallback, useRef, type TouchEvent as ReactTouchEvent, type RefObject } from 'react';

type SwipeStart = { x: number; y: number; atTop: boolean; atBottom: boolean; atLeft: boolean; atRight: boolean };

/** Moves between pages on a touch swipe while preserving zoomed-page panning. */
export function usePageSwipe(
  viewportRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  onPrevious: () => void,
  onNext: () => void,
  fittedPage = false,
) {
  const startRef = useRef<SwipeStart | null>(null);

  const touchStart = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    startRef.current = null;
    if (!enabled || event.touches.length !== 1) return;
    const target = event.target;
    if (target instanceof Element && target.closest('aside, [data-annotation-id], button, input, textarea, select, [role="button"], [role="dialog"]')) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const touch = event.touches[0];
    startRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      atTop: fittedPage || viewport.scrollTop <= 2,
      atBottom: fittedPage || viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 2,
      atLeft: viewport.scrollLeft <= 2,
      atRight: viewport.scrollLeft + viewport.clientWidth >= viewport.scrollWidth - 2,
    };
  }, [enabled, fittedPage, viewportRef]);

  const touchEnd = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    const start = startRef.current;
    startRef.current = null;
    if (!start || event.touches.length > 0 || !enabled) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) >= 64 && Math.abs(deltaX) >= Math.abs(deltaY) * 1.25) {
      if (deltaX < 0 && start.atRight) onNext();
      else if (deltaX > 0 && start.atLeft) onPrevious();
      return;
    }
    if (Math.abs(deltaY) >= 64 && Math.abs(deltaY) >= Math.abs(deltaX) * 1.25) {
      if (deltaY < 0 && start.atBottom) onNext();
      else if (deltaY > 0 && start.atTop) onPrevious();
    }
  }, [enabled, onNext, onPrevious]);

  const touchCancel = useCallback(() => { startRef.current = null; }, []);
  return { touchStart, touchEnd, touchCancel };
}
