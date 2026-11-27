import { useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from 'react';
import { adjustPopupRect, fitPopupRect, getPopupPreference, type PopupBounds, type PopupGesture,
  type PopupRect, type ViewerPopupKind } from '../model/viewerPopupGeometry.js';

export { viewerPopupBookKey } from '../model/viewerPopupGeometry.js';

type Options = {
  kind: ViewerPopupKind;
  bookKey: string;
  defaultRect: (bounds: PopupBounds) => PopupRect;
  minWidth: number;
  minHeight: number;
  open: boolean;
  boundsElement?: HTMLElement | null;
};

type Drag = {
  preference: ReturnType<typeof getPopupPreference>;
  gesture: PopupGesture;
  pointerId: number;
  clientX: number;
  clientY: number;
  rect: PopupRect;
};

const arrowOffsets: Partial<Record<string, { x: number; y: number }>> = {
  ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
};

function viewportBounds(): PopupBounds {
  if (typeof document === 'undefined') return { width: 0, height: 0 };
  return { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
}

/** Bind popupRef to the positioned element. Absolute popups use their offset parent's client area. */
export function useViewerPopupGeometry({ kind, bookKey, defaultRect, minWidth, minHeight, open, boundsElement }: Options) {
  const popupRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<{ drag: Drag; rect: PopupRect } | null>(null);
  const [bounds, setBounds] = useState(viewportBounds);
  const preference = getPopupPreference(kind, bookKey);
  const saved = useSyncExternalStore(preference.subscribe, preference.getSnapshot, () => null);
  const preferred = saved ?? defaultRect(bounds);
  const minimum = { width: minWidth, height: minHeight };
  const activePreview = open && preview?.drag === dragRef.current && preview.drag.preference === preference;
  const rect = fitPopupRect(activePreview ? preview.rect : preferred, bounds, minimum);

  useLayoutEffect(() => {
    if (!open) return;
    const container = boundsElement ?? popupRef.current?.offsetParent;
    const measure = () => {
      const size = container ? { width: container.clientWidth, height: container.clientHeight } : viewportBounds();
      setBounds((current) => current.width === size.width && current.height === size.height ? current : size);
    };
    const observer = container ? new ResizeObserver(measure) : null;
    if (container) observer?.observe(container);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      dragRef.current = null;
    };
  }, [open, boundsElement, preference]);

  function saveChange(gesture: PopupGesture, start: PopupRect, next: PopupRect) {
    if (gesture === 'move') {
      if (start.x !== next.x || start.y !== next.y) {
        preference.save({ ...preferred, x: start.x === next.x ? preferred.x : next.x, y: start.y === next.y ? preferred.y : next.y });
      }
    } else if (start.width !== next.width || start.height !== next.height) {
      preference.save({ ...preferred, x: start.x, y: start.y, width: start.width === next.width ? preferred.width : next.width,
        height: start.height === next.height ? preferred.height : next.height });
    }
  }

  function handleProps(gesture: PopupGesture) {
    const currentDrag = (event: PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      return drag?.preference === preference && drag.gesture === gesture && drag.pointerId === event.pointerId ? drag : null;
    };
    const nextRect = (drag: Drag, event: PointerEvent<HTMLElement>) => adjustPopupRect(drag.rect, gesture,
      event.clientX - drag.clientX, event.clientY - drag.clientY, bounds, minimum);
    const cancel = (event: PointerEvent<HTMLElement>) => {
      if (!currentDrag(event)) return;
      dragRef.current = null;
      setPreview(null);
    };
    return {
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (!event.isPrimary || event.button !== 0 || dragRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { preference, gesture, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, rect };
      },
      onPointerMove(event: PointerEvent<HTMLElement>) {
        const drag = currentDrag(event);
        if (!drag) return;
        setPreview({ drag, rect: nextRect(drag, event) });
      },
      onPointerUp(event: PointerEvent<HTMLElement>) {
        const drag = currentDrag(event);
        if (!drag) return;
        saveChange(gesture, fitPopupRect(drag.rect, bounds, minimum), nextRect(drag, event));
        cancel(event);
      },
      onPointerCancel: cancel,
      onLostPointerCapture: cancel,
      onKeyDown(event: KeyboardEvent<HTMLElement>) {
        const offset = arrowOffsets[event.key];
        if (!offset || dragRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        const step = event.shiftKey ? 20 : 5;
        saveChange(gesture, rect, adjustPopupRect(rect, gesture, offset.x * step, offset.y * step, bounds, minimum));
      },
    };
  }

  return { popupRef, rect, moveHandleProps: handleProps('move'), resizeHandleProps: handleProps('resize') };
}
