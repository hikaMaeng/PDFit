import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { ViewerWheelEvent } from '../useNonPassiveWheel.js';
import { isPdfTextRun, nearbyPdfTextCaret, pdfTextCaretAt } from '../../viewer/text-selection/selectionDom.js';

type PanStart = { pointerId: number; clientX: number; clientY: number; scrollLeft: number; scrollTop: number };
type TextDrag = { pointerId: number; anchor: NonNullable<ReturnType<typeof nearbyPdfTextCaret>> };

/** Provides hand-style PDF panning while the select tool is over empty page space. */
export function usePdfPan(viewportRef: RefObject<HTMLDivElement | null>, enabled: boolean, onEmptyPress: () => void) {
  const startRef = useRef<PanStart | null>(null);
  const textDrag = useRef<TextDrag | null>(null);
  const [active, setActive] = useState(false);

  const pointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || event.button !== 0 || !event.isPrimary) return;
    const target = event.target;
    if (target instanceof Element && target.closest('aside, [data-annotation-id], button, input, textarea, select, [role="button"], [role="dialog"]')) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    onEmptyPress();
    if (isPdfTextRun(target)) return;
    const anchor = event.pointerType === 'mouse' ? nearbyPdfTextCaret(event.clientX, event.clientY) : null;
    if (anchor && event.currentTarget.contains(anchor.layer)) {
      textDrag.current = { pointerId: event.pointerId, anchor };
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    startRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop };
    setActive(true);
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [enabled, onEmptyPress, viewportRef]);

  const pointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = textDrag.current;
    if (drag?.pointerId === event.pointerId) {
      const { anchor } = drag;
      if (!anchor.node.isConnected) return;
      const focus = pdfTextCaretAt(event.clientX, event.clientY) ?? nearbyPdfTextCaret(event.clientX, event.clientY);
      if (focus?.layer === anchor.layer) {
        window.getSelection()?.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
      }
      return;
    }
    const start = startRef.current;
    const viewport = viewportRef.current;
    if (!start || !viewport || start.pointerId !== event.pointerId) return;
    event.preventDefault();
    viewport.scrollLeft = start.scrollLeft - (event.clientX - start.clientX);
    viewport.scrollTop = start.scrollTop - (event.clientY - start.clientY);
  }, [viewportRef]);

  const finish = useCallback((event?: ReactPointerEvent<HTMLDivElement>) => {
    if (!event || textDrag.current?.pointerId === event.pointerId) textDrag.current = null;
    const start = startRef.current;
    if (event && start && start.pointerId !== event.pointerId) return;
    startRef.current = null;
    setActive(false);
    if (event && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  // Call from a non-passive listener (useNonPassiveWheel); React's onWheel ignores preventDefault.
  const wheel = useCallback((event: ViewerWheelEvent) => {
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
